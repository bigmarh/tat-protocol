const revealEls = [...document.querySelectorAll('.reveal')];

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.16,
  },
);

revealEls.forEach((el, index) => {
  el.style.animationDelay = `${index * 90}ms`;
  observer.observe(el);
});
