// Shared by the PWA login and /portal/. Re-rendering the app removes its timer.
const photos = [
  'besakih-candi.webp',
  'besakih-wantilan.webp',
  'besakih-talent.webp',
  'besakih-shuttle.webp',
];
const interval = 7000;

class BesakihPhotoSlideshow extends HTMLElement {
  connectedCallback() {
    this._events?.abort();
    this._events = new AbortController();
    const {signal} = this._events;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    this._index ??= 0;
    this._reducedMotion = motion.matches;
    if (!this.querySelector('.photo-slides')) {
      this.innerHTML = `<div class="photo-slides" aria-hidden="true">${photos.map((file, index) => `<img class="photo-slide photo-slide-${index}${index === 0 ? ' is-active' : ''}" ${index===0?'src':'data-src'}="${new URL(`assets/photos/${file}`, import.meta.url).href}" alt="" width="1024" height="683" decoding="async" fetchpriority="${index === 0 ? 'high' : 'low'}">`).join('')}</div>`;
    }
    this._images = [...this.querySelectorAll('.photo-slide')];
    document.addEventListener('visibilitychange', () => this._schedule(), {signal});
    motion.addEventListener('change', event => {
      this._reducedMotion = event.matches;
      this._schedule();
    }, {signal});
    this._schedule();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    this._events?.abort();
    this._selection = (this._selection || 0) + 1;
  }

  _schedule() {
    clearTimeout(this._timer);
    if (this._reducedMotion || document.hidden || !this.isConnected) return;
    this._timer = setTimeout(() => {
      for (let step = 1; step < photos.length; step++) {
        const next = (this._index + step) % photos.length;
        if (!this._images[next].dataset.unavailable) {
          this._show(next);
          return;
        }
      }
    }, interval);
  }

  async _show(index) {
    clearTimeout(this._timer);
    const selection = this._selection = (this._selection || 0) + 1;
    try {
      const image=this._images[index];if(!image.getAttribute('src'))image.src=image.dataset.src;
      await image.decode();
    } catch {
      if (this.isConnected && selection === this._selection) {
        this._images[index].dataset.unavailable = 'true';
        this._schedule();
      }
      return;
    }
    if (!this.isConnected || selection !== this._selection) return;
    this._index = index;
    this._images.forEach((image, current) => image.classList.toggle('is-active', current === index));
    this._schedule();
  }
}

if (!customElements.get('besakih-photo-slideshow')) {
  customElements.define('besakih-photo-slideshow', BesakihPhotoSlideshow);
}
