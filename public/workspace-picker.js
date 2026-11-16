// Enhance the module buttons supplied by the portal. They remain the source
// of available modules and keep their original routing and permission checks.
const app = document.getElementById('app');
const sharedRoutes = new Set(['#announcements', '#briefings', '#leaves', '#attendance']);
let sidebar;

function groupPageLinks(nav) {
  const shared = [];
  let node = nav.firstElementChild?.nextElementSibling;
  while (node?.matches('a.nav-link') && sharedRoutes.has(node.hash)) {
    shared.push(node);
    node = node.nextElementSibling;
  }
  if (!shared.length || !node?.matches('.nav-divider')) return;
  const divider = node;
  let last = divider.nextElementSibling;
  if (!last?.matches('a.nav-link')) return;
  while (last.nextElementSibling?.matches('a.nav-link')) last = last.nextElementSibling;
  const heading = document.createElement('p');
  heading.className = 'nav-group';
  heading.textContent = 'UMUM';
  last.after(divider, heading, ...shared);
}

function syncPicker() {
  const {root, nav, observer} = sidebar;
  const choices = root.querySelector('.workspace-switch');
  const buttons = choices ? [...choices.querySelectorAll('button[data-action]')] : [];
  if (!buttons.length) return;
  const active = buttons.find(button => button.classList.contains('active')) || buttons[0];
  const single = buttons.length === 1;
  const oldFocus = sidebar.focusedChoice;
  observer.disconnect();
  root.toggleAttribute('data-single', single);
  if (single) {
    if (sidebar.details) {
      root.append(choices);
      sidebar.details.remove();
      sidebar.details = null;
    }
    active.classList.add('workspace-current');
    active.removeAttribute('aria-pressed');
    choices.removeAttribute('id');
    choices.removeAttribute('role');
  } else {
    if (!sidebar.details) {
      const details = document.createElement('details');
      details.className = 'workspace-disclosure';
      details.innerHTML = '<summary class="workspace-current" aria-controls="workspace-options"><span class="workspace-emblem"></span><span class="workspace-name"></span><span class="workspace-chevrons" aria-hidden="true"></span></summary>';
      root.append(details);
      details.append(choices);
      sidebar.details = details;
    }
    choices.id = 'workspace-options';
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Pilih modul');
    for (const button of buttons) {
      button.classList.add('workspace-option');
      button.setAttribute('aria-pressed', String(button === active));
    }
    const trigger = sidebar.details.querySelector('summary');
    const label = active.textContent.trim();
    if (trigger.querySelector('.workspace-name').textContent !== label) {
      trigger.querySelector('.workspace-name').textContent = label;
      trigger.setAttribute('aria-label', 'Pilih modul, modul aktif ' + label);
      const glyph = active.querySelector('svg');
      if (glyph) trigger.querySelector('.workspace-emblem').replaceChildren(glyph.cloneNode(true));
    }
    observer.observe(sidebar.details, {childList: true});
  }
  // Background summaries can replace the original buttons while a user is
  // choosing a module. Keep the disclosure and restore the same choice.
  if (oldFocus && !oldFocus.isConnected && document.activeElement === document.body) {
    const next = sidebar.details?.open
      ? buttons.find(button => button.dataset.action === oldFocus.dataset.action)
      : null;
    (next || root.querySelector('.workspace-current')).focus({preventScroll: true});
  }
  groupPageLinks(nav);
  observer.observe(root, {childList: true});
  observer.observe(nav, {childList: true});
}

function mountSidebar() {
  const rail = app.querySelector('.sidebar');
  if (sidebar?.rail === rail) return;
  const focusMain = sidebar?.switching;
  sidebar?.observer.disconnect();
  sidebar = null;
  const choices = rail?.querySelector('.workspace-switch');
  const nav = rail?.querySelector('.sidebar-nav');
  if (!choices || !nav) return;
  const root = document.createElement('div');
  root.className = 'module-picker';
  root.innerHTML = '<span class="workspace-label">Modul kerja</span>';
  choices.before(root);
  root.append(choices);
  sidebar = {rail, root, nav, observer: new MutationObserver(syncPicker), details: null, focusedChoice: null, switching: false};
  root.addEventListener('focusin', event => {
    sidebar.focusedChoice = event.target.closest('button[data-action], summary');
  });
  root.addEventListener('click', event => {
    if (!event.target.closest('button[data-action]')) return;
    sidebar.switching = true;
    if (sidebar.details) {
      sidebar.details.open = false;
      sidebar.details.querySelector('summary').focus({preventScroll: true});
    }
  });
  syncPicker();
  if (focusMain) app.querySelector('#main')?.focus({preventScroll: true});
}

function closeOutside(event) {
  const picker = sidebar?.details;
  if (picker?.open && !picker.contains(event.target)) {
    picker.open = false;
    sidebar.focusedChoice = null;
  }
}

document.addEventListener('click', closeOutside);
document.addEventListener('focusin', closeOutside);
app.addEventListener('keydown', event => {
  const picker = event.target.closest('.workspace-disclosure');
  if (!picker) return;
  if (event.key === 'Escape' && picker.open) {
    event.preventDefault();
    picker.open = false;
    picker.querySelector('summary').focus();
    return;
  }
  if (!['Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  picker.open = true;
  const options = [...picker.querySelectorAll('button')];
  const current = options.indexOf(event.target);
  let next = options.findIndex(button => button.getAttribute('aria-pressed') === 'true');
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else if (current >= 0) next = (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options[next].focus();
});
new MutationObserver(mountSidebar).observe(app, {childList: true});
mountSidebar();
