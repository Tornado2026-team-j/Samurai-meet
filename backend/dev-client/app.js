const apiURL = document.querySelector('#api-url');
const result = document.querySelector('#result');

document.querySelectorAll('button[data-path]').forEach((button) => {
  button.addEventListener('click', async () => {
    const endpoint = `${apiURL.value.replace(/\/$/, '')}${button.dataset.path}`;
    result.textContent = `リクエスト中: ${endpoint}`;
    try {
      const response = await fetch(endpoint);
      const body = await response.json();
      result.textContent = JSON.stringify({ status: response.status, body }, null, 2);
    } catch (error) {
      result.textContent = `リクエストに失敗しました: ${error.message}`;
    }
  });
});
