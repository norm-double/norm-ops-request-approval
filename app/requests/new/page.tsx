'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { REQUEST_TYPES } from '@/lib/types';

export default function NewRequestPage() {
  const router = useRouter();
  const [type, setType] = useState<string>(REQUEST_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [requester, setRequester] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title,
          description,
          amount: Number(amount),
          requester,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create request');
        setSubmitting(false);
        return;
      }
      router.push(`/requests/${data.request.id}`);
      router.refresh();
    } catch {
      setError('Failed to create request');
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h1>New Operational Request</h1>
      <p className="muted">Creating a request also submits it for approval right away.</p>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="type">Request type</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="amount">Amount (USD)</label>
          <input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="requester">Requester name</label>
          <input
            id="requester"
            type="text"
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Create & Submit'}
        </button>
      </form>
    </div>
  );
}
