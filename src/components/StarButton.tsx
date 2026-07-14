"use client";

import { useEffect, useState } from "react";
import { readWatchlist, toggleWatch } from "./RankingsExplorer";

export default function StarButton({ ticker }: { ticker: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(readWatchlist().includes(ticker));
  }, [ticker]);

  return (
    <button
      className={`star star-lg ${on ? "on" : ""}`}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      onClick={() => setOn(toggleWatch(ticker).includes(ticker))}
    >
      ★
    </button>
  );
}
