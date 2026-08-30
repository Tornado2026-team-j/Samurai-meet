import { useState } from "react";
import { useParams, Link } from "react-router-dom";

const REASONS = [
  { id: "harassment", label: "嫌がらせ・迷惑行為" },
  { id: "inappropriate", label: "不適切な発言や写真" },
  { id: "danger", label: "危険な場所に連れて行かれた" },
  { id: "scam", label: "金銭的なトラブル" },
  { id: "other", label: "その他" },
] as const;

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!selectedReason || submitting) return;
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 800);
  };

  if (submitted) {
    return (
      <div className="screen">
        <div className="progress-dots">
          <div className="dot done" />
          <div className="dot done" />
          <div className="dot done" />
          <div className="dot done" />
        </div>
        <div className="complete-screen">
          <div className="complete-icon">📨</div>
          <div className="complete-title">報告を送信しました</div>
          <div className="complete-text">
            運営チームが確認の上、対応いたします。
            ご協力ありがとうございました。
          </div>
          <Link to="/" style={{ textDecoration: "none", width: "100%", maxWidth: 320 }}>
            <button className="btn btn-primary">ホームに戻る</button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="back-bar">
        <Link to={`/match-result/${id}/review`} className="back-btn">← 戻る</Link>
      </div>
      <div className="progress-dots">
        <div className="dot done" />
        <div className="dot done" />
        <div className="dot done" />
        <div className="dot active" />
      </div>
      <div className="header" style={{ paddingTop: 8, paddingBottom: 24 }}>
        <div className="header-title">運営への報告</div>
        <div className="header-subtitle">問題があった場合は報告できます</div>
      </div>
      <div className="content">
        <div className="section-description" style={{ textAlign: "left" }}>
          報告理由を選択してください
        </div>

        {REASONS.map((reason) => (
          <div
            key={reason.id}
            className={`report-reason ${selectedReason === reason.id ? "selected" : ""}`}
            onClick={() => setSelectedReason(reason.id)}
          >
            <div className="report-radio" />
            <div className="report-reason-text">{reason.label}</div>
          </div>
        ))}

        <div className="section-description" style={{ textAlign: "left" }}>
          詳細（任意）
        </div>
        <textarea
          className="report-textarea"
          placeholder="発生したことの詳細を教えてください"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={500}
        />

        <button
          className="btn btn-danger"
          disabled={!selectedReason || submitting}
          onClick={handleSubmit}
        >
          {submitting ? "送信中…" : "報告を送信"}
        </button>
      </div>
    </div>
  );
}
