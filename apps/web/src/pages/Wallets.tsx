import { useEffect, useState } from "react";
import { getTopWallets } from "../lib/api";

interface Wallet {
  address: string;
  role: string;
  swap_count: number;
  mint_count: number;
  burn_count: number;
  total_interactions: number;
}

const ROLE_COLORS: Record<string, string> = {
  swapper: "badge badge--blue",
  liquidity_provider: "badge badge--green",
  both: "badge badge--amber",
};

export function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTopWallets(50)
      .then((res) => setWallets(res.data))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="state-message state-message--error">Error: {error}</div>;

  return (
    <div className="page page--wallets">
      <div className="page__header">
        <h1 className="page__title">Top Wallets</h1>
        <p className="page__subtitle">
          Most active wallets by total interaction count, classified by role
        </p>
      </div>

      <div className="table-shell">
        <table className="wallet-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Address</th>
              <th>Role</th>
              <th>Swaps</th>
              <th>Mints</th>
              <th>Burns</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {wallets.map((w, i) => (
              <tr key={w.address}>
                <td>{i + 1}</td>
                <td className="wallet-table__address">
                  {w.address.slice(0, 6)}...{w.address.slice(-4)}
                </td>
                <td>
                  <span className={ROLE_COLORS[w.role] ?? "badge"}>
                    {w.role.replace("_", " ")}
                  </span>
                </td>
                <td>{w.swap_count}</td>
                <td>{w.mint_count}</td>
                <td>{w.burn_count}</td>
                <td className="wallet-table__total">{w.total_interactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
