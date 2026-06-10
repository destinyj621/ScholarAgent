import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch_ = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api(path)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(fetch_, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}
