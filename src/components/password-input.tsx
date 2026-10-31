'use client';
import { useState, type InputHTMLAttributes } from 'react';

export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={show ? 'text' : 'password'} className={`${className} pr-11`} />
      <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Sembunyikan sandi' : 'Tampilkan sandi'} aria-pressed={show}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center opacity-60 hover:opacity-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
          {show && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}
