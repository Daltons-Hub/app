import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";

export const SignaturePad = forwardRef(({ testId }, ref) => {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#0A0C0E";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (c.width / rect.width), y: (t.clientY - rect.top) * (c.height / rect.height) };
  };

  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext("2d"); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasInk.current = true; };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const c = canvasRef.current; const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#0A0C0E"; hasInk.current = false;
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk.current,
    clear,
    toBlob: () => new Promise((res) => canvasRef.current.toBlob(res, "image/png")),
  }));

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        data-testid={testId}
        width={600}
        height={220}
        className="w-full h-40 rounded-lg border border-slate-700 bg-white touch-none"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button type="button" data-testid="signature-clear" onClick={clear}
        className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-slate-800/80 text-slate-200">Clear</button>
    </div>
  );
});
