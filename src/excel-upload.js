/* Worker lifetime is bounded so a damaged file cannot freeze the UI. */
window.preprocessExcel = async function(file) {
  if (file.size > 25 * 1048576) throw new Error('حداکثر حجم فایل ۲۵ مگابایت است.');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker('src/excel-worker.js');
    const timer = setTimeout(() => finish(new Error('پردازش بیش از ۳۰ ثانیه طول کشید. فایل را به بخش‌های کوچک‌تر تقسیم کنید.')), 30000);
    function finish(error, result) { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); }
    worker.onerror = () => finish(new Error('پیش‌پردازش در دسترس نیست. دوباره تلاش کنید.'));
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
    worker.postMessage(buffer, [buffer]);
  });
};
