import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Check, AlertCircle } from 'lucide-react';
import { subscribeToasts, type Toast } from '../../lib/toast';
import './ToastContainer.css';

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return ReactDOM.createPortal(
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item toast-item--${t.type}`}>
          {t.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
};
