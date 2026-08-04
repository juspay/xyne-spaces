(function () {
  const theme = new URLSearchParams(location.search).get('theme');
  document.documentElement.dataset.theme = ['classic', 'midnight', 'summer_breeze'].includes(theme)
    ? theme
    : 'classic';
})();
