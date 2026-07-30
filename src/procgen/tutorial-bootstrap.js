export function ensureTutorialInterface() {
  if (!document.querySelector('[data-tutorial-styles]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './src/procgen/tutorial-overlay.css?v=20260727-organic-card-2';
    link.dataset.tutorialStyles = 'true';
    document.head.appendChild(link);
  }

  let root = document.getElementById('tutorial-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'tutorial-root';
    document.body.appendChild(root);
  }

  let desktopButton = document.getElementById('tutorial-library-button');
  if (!desktopButton) {
    desktopButton = document.createElement('button');
    desktopButton.id = 'tutorial-library-button';
    desktopButton.type = 'button';
    desktopButton.setAttribute('aria-label', 'Abrir biblioteca didática');
    desktopButton.title = 'Biblioteca didática — tecla H';
    desktopButton.innerHTML = '<span aria-hidden="true">◈</span><span>GUIA</span>';
    document.body.appendChild(desktopButton);
  }

  const tools = document.getElementById('mobile-tools');
  if (tools && !tools.querySelector('[data-mobile-action="tutorial"]')) {
    const mobileButton = document.createElement('button');
    mobileButton.className = 'mobile-tool';
    mobileButton.type = 'button';
    mobileButton.dataset.mobileAction = 'tutorial';
    mobileButton.setAttribute('aria-label', 'Abrir biblioteca didática');
    mobileButton.title = 'Biblioteca didática';
    mobileButton.textContent = '◈';
    const debugButton = tools.querySelector('[data-mobile-action="debug"]');
    tools.insertBefore(mobileButton, debugButton || tools.firstChild);
  }

  return { root, desktopButton };
}
