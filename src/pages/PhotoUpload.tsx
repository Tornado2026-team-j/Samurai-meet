import { useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

interface DemoMatch {
  id: string;
  partnerName: string;
  partnerInitial: string;
  nationality: string;
  category: string;
  date: string;
  duration: string;
  rating: number;
  identityVerified: boolean;
}

const demoMatch: DemoMatch = {
  id: "demo",
  partnerName: "Yuki Tanaka",
  partnerInitial: "Y",
  nationality: "JP",
  category: "観光地",
  date: "2026/08/30",
  duration: "10:00 - 13:00",
  rating: 4.8,
  identityVerified: true,
};

export default function PhotoUpload() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleComplete = () => {
    if (completing) return;
    setCompleting(true);
    setTimeout(() => {
      setCompleting(false);
      setShowModal(true);
    }, 800);
  };

  const match = demoMatch;

  return (
    <div className="screen">
      <div className="back-bar">
        <Link to="/" className="back-btn">← 戻る</Link>
      </div>
      <div className="progress-dots">
        <div className="dot active" />
        <div className="dot" />
        <div className="dot" />
        <div className="dot" />
      </div>
      <div className="header" style={{ paddingTop: 8, paddingBottom: 24 }}>
        <div className="header-title">案内の思い出を残そう</div>
        <div className="header-subtitle">一緒に過ごした時間の写真をアップロード</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-row">
            <div className="avatar">{match.partnerInitial}</div>
            <div style={{ flex: 1 }}>
              <div className="card-name">{match.partnerName}</div>
              <div className="card-meta">{match.category} · {match.date}</div>
              <div className="card-meta">{match.duration}</div>
            </div>
            <span className={`card-badge ${match.identityVerified ? "badge-verified" : "badge-pending"}`}>
              {match.identityVerified ? "本人確認済み" : "確認中"}
            </span>
          </div>
        </div>

        {photoUrl ? (
          <div className="photo-preview">
            <img src={photoUrl} alt="アップロードした写真" />
            <button
              className="photo-remove"
              onClick={() => setPhotoUrl(null)}
              aria-label="写真を削除"
            >
              ×
            </button>
          </div>
        ) : (
          <div
            className="photo-area"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="photo-icon">📷</div>
            <div className="photo-hint">タップして写真を選択</div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        <button
          className="btn btn-primary"
          disabled={!photoUrl || completing}
          onClick={handleComplete}
        >
          {completing ? "送信中…" : "完了して次へ"}
        </button>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">✅</div>
            <div className="modal-title">写真をアップロードしました</div>
            <div className="modal-text">次はモンスターを交換しましょう！</div>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/match-result/${id}/exchange`)}
            >
              モンスター交換へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
