let count = 0;

export function openModal() {
  count++;
  document.getElementById('root')?.classList.add('modal-open');
}

export function closeModal() {
  count = Math.max(0, count - 1);
  if (count === 0) document.getElementById('root')?.classList.remove('modal-open');
}
