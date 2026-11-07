// Get Current Year
function getCurrentYear() {
  var d = new Date();
  var year = d.getFullYear();
  const yearElement = document.querySelector('#displayDateYear');
  if (yearElement) yearElement.innerText = year;
}
getCurrentYear();

// The carousel is optional; the rest of the page also works when its CDN is unavailable.
if (typeof window.jQuery?.fn?.owlCarousel === 'function') {
  $('.owl-carousel').owlCarousel({
    loop: true,
    margin: 10,
    nav: true,
    dots: false,
    navText: [
      '<i class="fa fa-long-arrow-left" aria-hidden="true"></i>',
      '<i class="fa fa-long-arrow-right" aria-hidden="true"></i>',
    ],
    autoplay: true,
    autoplayHoverPause: true,
    responsive: {
      0: {
        items: 1,
      },
      768: {
        items: 2,
      },
      1000: {
        items: 2,
      },
    },
  });
}
