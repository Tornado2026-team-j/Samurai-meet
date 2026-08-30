import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<"like" | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleLike = () => {
    if (submitted) return;
    setSelected("like");
    setTimeout(() => {
      setSubmitted(true);
    }, 300);
  };

  return (
    <div className="screen">
      <div className="back-bar">
        <Link to={`/match-result/${id}/exchange`} className="back-btn">← 戻る</Link>
      </div>
      <div className="progress-dots">
        <div className="dot done" />
        <div className="dot done" />
        <div className="dot active" />
        <div className="dot" />
      </div>
      <div className="header" style={{ paddingTop: 8, paddingBottom: 24 }}>
        <div className="header-title">相互評価</div>
        <div className="header-subtitle">案内相手に「いいね」を送ろう</div>
      </div>
      <div className="content">
        {submitted && (
          <div className="banner banner-success">
            <span>✅</span>
            <span>いいねを送りました！ありがとうございました。</span>
          </div>
        )}

        <div className="card">
          <div className="card-row">
            <div className="avatar">Y</div>
            <div style={{ flex: 1 }}>
              <div className="card-name">Yuki Tanaka</div>
              <div className="card-meta">評価は1回だけ送信できます</div>
            </div>
          </div>
        </div>

        <div className="like-row">
          <div
            className={`like-card ${selected === "like" ? "selected" : ""}`}
            onClick={handleLike}
          >
            <div className="like-emoji">👍</div>
            <div className="like-label">いいね！</div>
          </div>
        </div>

        {submitted && (
          <button
            className="btn btn-secondary"
            onClick={() => navigate(`/match-result/${id}/report`)}
          >
            報告画面へ進む
          </button>
        )}
      </div>
    </div>
  );
}
