const apiURL = document.querySelector('#api-url');
const result = document.querySelector('#result');

// 公開ドメインでは、同一オリジンの開発プロキシを経由してローカルAPIへ接続する。
if (window.location.hostname === 'samurai-meet.disnana.com') {
  apiURL.value = `${window.location.origin}/api/v1`;
}

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
