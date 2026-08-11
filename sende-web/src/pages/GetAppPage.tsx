export default function GetAppPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <img src="/moyosend-wordmark.svg" alt="MoyoSend" style={{ height: 40, marginBottom: 24 }} />
      <h1>The MoyoSend app is on its way</h1>
      <p className="muted" style={{ maxWidth: 420 }}>
        We're putting the finishing touches on the MoyoSend mobile app. In the meantime, you can send money and
        manage your account from any browser at moyosore.de.
      </p>
    </div>
  );
}