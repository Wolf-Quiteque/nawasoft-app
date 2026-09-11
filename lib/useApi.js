'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Small GET-fetch hook: { data, loading, error, refetch }. Re-fetches when `url` changes. */
export function useApi(url, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const refetch = useCallback(() => {
    if (!url || skip) return;
    const id = (requestId.current += 1);
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Falha ao carregar dados');
        if (id === requestId.current) setData(body);
      })
      .catch((err) => {
        if (id === requestId.current) setError(err.message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [url, skip]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
