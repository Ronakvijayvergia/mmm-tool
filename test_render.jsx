import { useState } from "react";

export default function TestRender() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1 style={{ color: "#2563eb" }}>MMM Tool Test</h1>
      <p>If you can see this, React rendering works!</p>
      <button
        onClick={() => setCount(c => c + 1)}
        style={{ padding: "8px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: 8, cursor: "pointer", marginTop: 16 }}>
        Clicked {count} times
      </button>
    </div>
  );
}
