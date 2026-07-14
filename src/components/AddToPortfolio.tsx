"use client";

import { useEffect, useState } from "react";
import { addPosition, hasPosition, removePosition } from "@/lib/portfolio";

export default function AddToPortfolio({
  ticker,
  name,
  price,
}: {
  ticker: string;
  name: string;
  price: number;
}) {
  const [inPf, setInPf] = useState(false);

  useEffect(() => {
    setInPf(hasPosition(ticker));
  }, [ticker]);

  function toggle() {
    if (inPf) {
      removePosition(ticker);
      setInPf(false);
    } else {
      addPosition({ ticker, name, entryPrice: price, date: new Date().toISOString().slice(0, 10) });
      setInPf(true);
    }
  }

  return (
    <button className="btn-outline" onClick={toggle}>
      {inPf ? "✓ In portfolio" : "＋ Portfolio"}
    </button>
  );
}
