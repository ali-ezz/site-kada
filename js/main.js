// Eye intro adapted and simplified. Uses GSAP when available for timeline control.

(function(){
  // Simple helpers and state (trimmed from original)
  function randomInt(min,max){return Math.floor(Math.random()*(max-min+1))+min}
  function lerp(a,t,b){return a*(1-t)+b*t}

  var eye = null;
  var lids = null;
  var iris = {ref:null,x:45,y:45,w:72,h:72,color:''};
  var pupil = {ref:null,size:36,sizeGoal:36};
  var mouse={x:45,y:45,oldX:45,oldY:45};
  // reduce movement so the pupil/iris group can't travel too far (prevents pupil appearing outside the eye)
  var distanceThreshold = 24;
  var xp=45, yp=45;
  var loadProgress = 0;
  var loadInterval = null;
  // dynamic bounds
  var irisGroup = null;
  var svgOuter = null;
  var eyeCenter = {x:0,y:0};
  var maxIrisRadius = 24; // will be computed
  // make the movement space larger and still smooth
  // make the movement space very large (near full available) and keep motion smooth
  var movementMultiplier = 1.0; // multiplier for final target (easy tuning)
  // increase smoothing value to make motion snappier (higher = faster response)
  var smoothing = 0.18; // was 0.07, bumped for faster feel
  var targetX = 0, targetY = 0; // animation targets
  var currX = 0, currY = 0;   // current animated values
  // removed pupil parallax - iris and pupil now move as one unit
  var attractors = [];
  var attractorInfluence = 320; // px, will be adjusted on computeEyeBounds
  var showDebug = false;
  var debugLayer = null;

  // Initialize as soon as DOM is ready so the loader becomes the primary perceived loading UI
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // DOM already ready
    setTimeout(init, 0);
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

  function init(){
    eye = document.querySelector('.horus-eye');
    // SVG parts
    iris.ref = document.getElementById('horus-iris');
    pupil.ref = document.getElementById('horus-pupil');
    irisGroup = document.getElementById('horus-iris-group');
    svgOuter = document.getElementById('horus-outer');
    lids = document.querySelector('.horus-gold');

    // kickoff: use GSAP timeline if available
    if (window.gsap && gsap.timeline){
      runGSAPIntro();
    } else {
      // fallback: simple JS animation then reveal
      simpleIntro();
    }

    window.addEventListener('mousemove', onMouseMove);

  // compute dynamic bounds now and whenever the window resizes
  computeEyeBounds();
  window.addEventListener('resize', function(){ computeEyeBounds(); collectAttractors(); });
  window.addEventListener('scroll', collectAttractors);

  // find blue attractor patches
  collectAttractors();

    // debug overlay (toggle with 'd')
    debugLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    debugLayer.setAttribute('class','debug-layer');
    debugLayer.setAttribute('style','position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:10000');
    document.body.appendChild(debugLayer);
    window.addEventListener('keydown', function(e){ if (e.key === 'd') { showDebug = !showDebug; debugLayer.style.display = showDebug ? 'block' : 'none'; } });

  // start RAF loop for smooth iris movement
  requestAnimationFrame(animateIris);

  // start real loading monitor: wait for content images/fonts to load (with a fallback timeout)
  startRealLoadingMonitor();

    // Note: outer white shape click pulled it out previously; that behavior is disabled
    // to avoid moving the background when the user clicks the eye.
  }

  function computeEyeBounds(){
    // compute center and maximum translation for the iris group so it stays inside the outer eye path
    if (!svgOuter || !irisGroup) return;
    var outerRect = svgOuter.getBoundingClientRect();
    var irisRect = irisGroup.getBoundingClientRect();

    eyeCenter.x = outerRect.left + outerRect.width/2;
    eyeCenter.y = outerRect.top + outerRect.height/2;

  // maximum radius available: half of the smaller outer dimension minus half of iris size and a small padding
  var avail = Math.min(outerRect.width, outerRect.height)/2 - Math.max(irisRect.width, irisRect.height)/2 - 4;
  var availMax = Math.min(outerRect.width, outerRect.height)/2 - Math.max(irisRect.width, irisRect.height)/2 - 1;
  // Use near-full available radius (95%) so the iris/pupil can travel a very large space but stays inside the eye
  maxIrisRadius = Math.max(6, Math.round(availMax * 0.95));
  // set attractor influence proportional to eye size
  attractorInfluence = Math.max(180, Math.round(Math.max(outerRect.width, outerRect.height) * 1.2));
  }

  function collectAttractors(){
    attractors = [];
    var paths = document.querySelectorAll('path');
    paths.forEach(function(p){
      var style = p.getAttribute('style') || '';
      var fillAttr = p.getAttribute('fill') || '';
      var isBlue = false;
      if (style.indexOf('#5E9CEA') !== -1 || fillAttr.indexOf('#5E9CEA') !== -1) isBlue = true;
      // also check computed style
      try{
        var cs = window.getComputedStyle(p);
        if (cs && cs.fill && (cs.fill.indexOf('rgb(94') === 0 || cs.fill.indexOf('#5e9cea') !== -1)) isBlue = true;
      }catch(e){}

      if (isBlue){
        var r = p.getBoundingClientRect();
        attractors.push({x: r.left + r.width/2, y: r.top + r.height/2, el: p});
      }
    });
  }

  // Monitor real page resources (images within #content and document.fonts) and update the loader bar.
  // Resolves when resources are ready or when the fallback timeout is reached.
  function startRealLoadingMonitor(){
    var barFill = document.querySelector('.loader-bar-fill');
    var content = document.getElementById('content');

    // collect images inside #content (if not found, fall back to all images)
    var images = [];
    if (content) images = Array.from(content.querySelectorAll('img'));
    if (!images.length) images = Array.from(document.images || []);

    var total = Math.max(1, images.length);
    var loaded = 0;

    function setFill(p){ if (barFill) barFill.style.width = Math.min(100, Math.round(p)) + '%'; }

    // quick initial bump so the bar isn't empty immediately
    setFill(6);

    images.forEach(function(img){
      if (img.complete && img.naturalWidth !== 0){
        loaded++;
        setFill((loaded/total) * 85);
        return;
      }
      img.addEventListener('load', function(){ loaded++; setFill((loaded/total) * 85); });
      img.addEventListener('error', function(){ loaded++; setFill((loaded/total) * 85); });
    });

    // include font loading if available
    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

    // watch progress and resolve when images are done and fonts ready, or on timeout
    var finished = false;
    var fallbackTimeout = 12000; // 12s fallback

    var checkInterval = setInterval(function(){
      var percent = (loaded/total) * 85; // images account for up to 85%
      // micro-progress towards 95% as time passes to avoid stalling UI
      var timeElapsed = Math.min(1, (Date.now() - startTime) / fallbackTimeout);
      var gentle = 85 + Math.round(timeElapsed * 10); // up to 95
      setFill(Math.min(percent, gentle));

      if (loaded >= total) {
        // images loaded; wait for fonts then finish
        Promise.all([fontsReady]).then(function(){
          if (finished) return;
          finished = true;
          clearInterval(checkInterval);
          clearTimeout(fallback);
          setFill(100);
          setTimeout(finishLoading, 650);
        });
      }
    }, 150);

    var startTime = Date.now();
    var fallback = setTimeout(function(){
      if (finished) return;
      finished = true;
      clearInterval(checkInterval);
      setFill(100);
      setTimeout(finishLoading, 700);
    }, fallbackTimeout);
  }

  function runGSAPIntro(){
    // DO NOT call revealContent here - let finishLoading() handle it after the bar completes
    var tl = gsap.timeline();

    // subtle iris focus sequence; no blinking of the outer eye
    tl.to('#horus-iris-group', {duration:0.6, x: -12, y: -6, ease: 'power2.inOut'})
      .to('#horus-iris-group', {duration:0.7, x: 8, y: 10, ease: 'power2.inOut'})
      // quick gold shimmer
      .fromTo('.horus-gold', {opacity:0.6, filter:'brightness(0.9)'}, {duration:0.6, opacity:1, filter:'brightness(1.25)', ease:'power1.inOut'}, '<');
  }

  function simpleIntro(){
    // fallback: no intro animation, just wait for loading to finish
    // DO NOT reveal content here
  }

  // Called when loading completes: pupil closes, zoom into eye, eye disappears, page fades in element by element
  function finishLoading(){
    var horus = document.querySelector('.horus-eye');
    var loader = document.getElementById('loader');
    var bar = document.querySelector('.loader-bar');
    var content = document.getElementById('content');

    if (window.gsap && gsap.timeline){
      var tl = gsap.timeline();
      
      // Step 1: Bar fades out quickly
      tl.to(bar, { duration:0.4, opacity:0, ease:'power2.out' })

      // Step 2: Pupil shrinks faster
      .to('#horus-pupil', { duration:0.45, scale:0, transformOrigin:'center center', ease:'power3.in' }, '+=0.12')

      // Step 3: Iris shrinks
      .to('#horus-iris', { duration:0.45, scale:0, transformOrigin:'center center', ease:'power3.in' }, '-=0.28')

      // Step 4: Zoom into pupil center (faster)
      .to(horus, {
        duration:1.2,
        scale:28,
        x:0,
        y:0,
        transformOrigin:'50% 40.6%',
        ease:'power3.inOut',
        onUpdate: function(){
          var progress = this.progress();
          if (progress > 0.6) loader.style.background = 'rgba(255,255,255,' + Math.min(1, (progress - 0.6) * 2.5) + ')';
        }
      }, '-=0.3')

      // Step 5: Reveal content immediately
      .call(function(){ loader.style.display='none'; loader.setAttribute('aria-hidden','true'); content.setAttribute('aria-hidden','false'); content.style.display='block'; content.style.opacity='1'; }, null, '>')

      // Step 6: Faster, unified reveal for most page elements
      .fromTo('.tabs', {opacity:0, y:18}, {duration:0.45, opacity:1, y:0, ease:'power2.out'}, '-=0.05')
      .fromTo('.tab-content, .hero-section, .hero-ctas, .info-cards .card, .stats-grid .stat-card, .services-grid .service-item, .about-content, .partners-section, .news-section, .site-footer',
        {opacity:0, y:18, scale:0.985},
        {duration:0.55, opacity:1, y:0, scale:1, stagger:0.08, ease:'power2.out'},
        '-=0.35');
        
    } else {
      // Fallback without GSAP
      // Step 1: Fade out bar
      if (bar) {
        bar.style.transition = 'opacity 0.6s ease';
        bar.style.opacity = '0';
      }
      
      // Step 2: Shrink pupil (faster)
      setTimeout(function(){
        if (pupil.ref) {
          pupil.ref.style.transition = 'transform 0.45s cubic-bezier(0.76, 0, 0.24, 1)';
          pupil.ref.style.transform = 'scale(0)';
        }
      }, 420);

      // Step 3: Shrink iris
      setTimeout(function(){
        if (iris.ref) {
          iris.ref.style.transition = 'transform 0.45s cubic-bezier(0.76, 0, 0.24, 1)';
          iris.ref.style.transform = 'scale(0)';
        }
      }, 680);

      // Step 4: Zoom into center (faster)
      setTimeout(function(){
        horus.style.transition = 'transform 1.2s cubic-bezier(0.22, 0.9, 0.28, 1)';
        horus.style.transformOrigin = '50% 40.6%';
        horus.style.transform = 'scale(28)';
      }, 900);

      // Step 5: Reveal content once zoom completes
      setTimeout(function(){
        loader.style.display = 'none';
        loader.setAttribute('aria-hidden','true');
        content.setAttribute('aria-hidden','false');
        content.style.display = 'block';
        content.style.opacity = '1';

        // Unified reveal: select main blocks
        var revealBlocks = document.querySelectorAll('.tabs, .tab-content, .hero-section, .hero-ctas, .info-cards .card, .stats-grid .stat-card, .services-grid .service-item, .about-content, .partners-section, .news-section, .site-footer');
        revealBlocks.forEach(function(el, i){
          el.style.opacity = '0';
          el.style.transform = 'translateY(16px) scale(0.985)';
          el.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
          setTimeout(function(){ el.style.opacity = '1'; el.style.transform = 'translateY(0) scale(1)'; }, 120 + i * 70);
        });

      }, 2100);
    }
  }

  var outerPulled = false;
  function pullOuterOut(){
    if (outerPulled) return;
    outerPulled = true;
    var outer = document.getElementById('horus-outer');
    if (!outer) return;

    if (window.gsap && gsap.to){
      gsap.to(outer, {duration:0.9, x: 160, y: -40, rotation: 18, scale: 1.04, transformOrigin:'50% 50%', ease:'power3.out', onComplete:function(){
        gsap.to(outer, {duration:0.6, opacity:0, ease:'power2.in'});
      }});
    } else {
      outer.style.transform = 'translate(160px,-40px) rotate(18deg) scale(1.04)';
      setTimeout(function(){ outer.classList.add('hidden'); }, 700);
    }
  }

  function onMouseMove(e){
    // compute dx/dy from pointer to center and clamp to maxIrisRadius
    var dx = e.clientX - eyeCenter.x;
    var dy = e.clientY - eyeCenter.y;
    var dist = Math.sqrt(dx*dx + dy*dy) || 1;

    var clampedDist = Math.min(dist, maxIrisRadius);
    var tx = dx * (clampedDist / dist);
    var ty = dy * (clampedDist / dist);

  // apply a movement multiplier so the user sees a larger space
  // set animation targets; RAF loop will smooth movement. Use most of the available radius (95%)
  targetX = tx * 0.95 * movementMultiplier;
  targetY = ty * 0.95 * movementMultiplier;
  }

  function animateIris(){
    // lerp current toward target for smooth motion
    currX = currX + (targetX - currX) * smoothing;
    currY = currY + (targetY - currY) * smoothing;

    if (irisGroup) {
      irisGroup.setAttribute('transform', 'translate(' + currX + ',' + currY + ')');
    }

    // iris and pupil now move together as one unit (no separate pupil movement)

    // debug: draw attractors and current iris position
    if (debugLayer && showDebug){
      while (debugLayer.firstChild) debugLayer.removeChild(debugLayer.firstChild);
      attractors.forEach(function(a){
        var c = document.createElementNS('http://www.w3.org/2000/svg','circle');
        c.setAttribute('cx', a.x); c.setAttribute('cy', a.y); c.setAttribute('r', 8); c.setAttribute('fill','rgba(0,120,255,0.6)');
        debugLayer.appendChild(c);
      });
      // iris center in screen coords
      var irisScreenX = eyeCenter.x + currX;
      var irisScreenY = eyeCenter.y + currY;
      var t = document.createElementNS('http://www.w3.org/2000/svg','circle');
      t.setAttribute('cx', irisScreenX); t.setAttribute('cy', irisScreenY); t.setAttribute('r', 6); t.setAttribute('fill','rgba(255,50,50,0.85)');
      debugLayer.appendChild(t);
      // max movement circle
      var boundary = document.createElementNS('http://www.w3.org/2000/svg','circle');
      boundary.setAttribute('cx', eyeCenter.x); boundary.setAttribute('cy', eyeCenter.y); boundary.setAttribute('r', maxIrisRadius); boundary.setAttribute('stroke','rgba(0,255,0,0.3)'); boundary.setAttribute('fill','none'); debugLayer.appendChild(boundary);
    }

    requestAnimationFrame(animateIris);
  }

})();

// Tab Navigation System
document.addEventListener('DOMContentLoaded', function(){
  var tabs = document.querySelectorAll('.tab');
  var tabPanels = document.querySelectorAll('.tab-panel');
  
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      var targetTab = this.getAttribute('data-tab');
      
      // Remove active class from all tabs and panels
      tabs.forEach(function(t){ 
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(function(p){ 
        p.classList.remove('active'); 
      });
      
      // Add active class to clicked tab and corresponding panel
      this.classList.add('active');
      this.setAttribute('aria-selected', 'true');
      var targetPanel = document.getElementById(targetTab + '-tab');
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
  
  // Contact form submission (you can customize this)
  var contactForm = document.querySelector('.contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', function(e){
      e.preventDefault();
      alert('تم إرسال الرسالة بنجاح! سنتواصل معك قريباً.');
      this.reset();
    });
  }
});
