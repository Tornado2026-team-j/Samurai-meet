import { Link } from "react-router-dom";

const demoId = "demo";

export default function LandingPage() {
  return (
    <div className="screen">
      <div className="header">
        <div className="header-title">Samurai Meet</div>
        <div className="header-subtitle">案内終了後の結果フロー</div>
      </div>
      <div className="content">
        <div className="section-title">Preview</div>
        <div className="section-description">
          案内結果フローの各画面を確認できます。
        </div>
        <Link to={`/match-result/${demoId}`} style={{ textDecoration: "none" }}>
          <button className="btn btn-primary">結果フローを開始</button>
        </Link>
        <Link to={`/match-result/${demoId}/exchange`} style={{ textDecoration: "none" }}>
          <button className="btn btn-secondary">モンスター交換</button>
        </Link>
        <Link to={`/match-result/${demoId}/review`} style={{ textDecoration: "none" }}>
          <button className="btn btn-secondary">相互評価</button>
        </Link>
        <Link to={`/match-result/${demoId}/report`} style={{ textDecoration: "none" }}>
          <button className="btn btn-secondary">運営への報告</button>
        </Link>
      </div>
    </div>
  );
}
