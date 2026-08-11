import { useRef } from "react";
import QRCode from "react-qr-code";

const APP_LANDING_URL = `${window.location.origin}/app`;

export default function GetAppPanel() {
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  function downloadQrCode() {
    const svg = qrWrapperRef.current?.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.onload = () => {
      const padding = 32;
      const canvas = document.createElement("canvas");
      canvas.width = image.width + padding * 2;
      canvas.height = image.height + padding * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, padding, padding);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "moyosend-app-qr.png";
        link.click();
        URL.revokeObjectURL(link.href);
      });
    };
    image.src = url;
  }

  return (
    <section>
      <h2>Get the app</h2>
      <p className="muted">
        Scan this code with your phone's camera to open the MoyoSend app page, or download it to share.
      </p>
      <div
        ref={qrWrapperRef}
        style={{
          background: "#fff",
          padding: 16,
          display: "inline-block",
          borderRadius: 8,
          border: "1px solid #e6e1d6",
        }}
      >
        <QRCode value={APP_LANDING_URL} size={180} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={downloadQrCode}>Download QR code</button>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        {APP_LANDING_URL}
      </p>
    </section>
  );
}