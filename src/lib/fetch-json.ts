// POST med JSON för långa AI-anrop. Hostingens proxy kan ibland svara 502/504
// på förfrågningar som tar över en minut - då görs ett nytt försök automatiskt.
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown, retries = 1): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if ((res.status === 502 || res.status === 504) && attempt < retries) continue;
    // Ett proxyfel är inte JSON
    const data = await res.json().catch(() => ({ error: `Servern svarade inte (${res.status}) – försök igen` }));
    return { ok: res.ok, status: res.status, data };
  }
}
