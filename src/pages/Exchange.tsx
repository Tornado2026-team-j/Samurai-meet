import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

type Phase = "enter" | "meet" | "exchange" | "done";

export default function Exchange() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("enter");
  const [showSpark, setShowSpark] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("meet"), 400);
    const t2 = setTimeout(() => {
      setShowSpark(true);
      setPhase("exchange");
    }, 1300);
    const t3 = setTimeout(() => {
      setShowSpark(false);
      setPhase("done");
      setShowModal(true);
    }, 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const leftClass =
    phase === "enter" ? "" :
    phase === "meet" ? "monster-center-left" :
    "monster-final-left";

  const rightClass =
    phase === "enter" ? "" :
    phase === "meet" ? "monster-center-right" :
    "monster-final-right";

  return (
    <div className="screen">
      <div className="back-bar">
        <Link to={`/match-result/${id}`} className="back-btn">← 戻る</Link>
      </div>
      <div className="progress-dots">
        <div className="dot done" />
        <div className="dot active" />
        <div className="dot" />
        <div className="dot" />
      </div>
      <div className="header" style={{ paddingTop: 8, paddingBottom: 24 }}>
        <div className="header-title">モンスター交換</div>
        <div className="header-subtitle">お互いのモンスターを交換しよう！</div>
      </div>
      <div className="exchange-stage">
        <div
          className={`monster monster-left ${leftClass}`}
          style={{ opacity: phase === "enter" ? 0 : 1 }}
        >
          🐉
        </div>
        <div
          className={`monster monster-right ${rightClass}`}
          style={{ opacity: phase === "enter" ? 0 : 1 }}
        >
          🦜
        </div>
        <div className={`exchange-spark ${showSpark ? "show" : ""}`} style={{ fontSize: 48 }}>
          ✨
        </div>
      </div>
      <div className="content" style={{ paddingTop: 0 }}>
        <div className="section-description">
          {phase === "enter" && "モンスターが近づいています…"}
          {phase === "meet" && "モンスターが出会いました！"}
          {phase === "exchange" && "交換中…"}
          {phase === "done" && "交換完了！"}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">🤝</div>
            <div className="modal-title">交換完了！</div>
            <div className="modal-text">
              新しいモンスターが保管庫に追加されました。
              次はお互いに「いいね」を送りましょう。
            </div>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/match-result/${id}/review`)}
            >
              評価へ進む
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
