package integration

import (
	"context"
	"testing"
	"time"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/notification"
)

func TestMarkAllReadIsScopedToUserAndIncludesRetainedNotifications(t *testing.T) {
	database := openIsolatedDatabase(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 3, 12, 0, 0, 0, time.UTC)
	userID := randomID(t)
	otherUserID := randomID(t)
	insertMatchingTestUser(t, database, now, userID, "Notification owner", "JP")
	insertMatchingTestUser(t, database, now, otherUserID, "Other notification user", "US")

	insertNotification := func(id, ownerID, eventKey string, createdAt time.Time, readAt any) {
		t.Helper()
		_, err := database.Exec(`
			INSERT INTO notifications (
				id,user_id,event_key,type,target_id,destination,created_at,read_at
			) VALUES ($1,$2,$3,'new_message',$4,'chat',$5,$6)`,
			id, ownerID, eventKey, "chat-"+ownerID, createdAt.UTC().Format(time.RFC3339Nano), readAt)
		if err != nil {
			t.Fatalf("insert notification %q error = %v", id, err)
		}
	}

	insertNotification(randomID(t), userID, "notification-unread-recent", now.Add(-time.Hour), nil)
	insertNotification(randomID(t), userID, "notification-unread-retained", now.Add(-8*24*time.Hour), nil)
	insertNotification(randomID(t), userID, "notification-already-read", now.Add(-2*time.Hour), now.Add(-time.Minute).Format(time.RFC3339Nano))
	insertNotification(randomID(t), otherUserID, "notification-other-user", now.Add(-time.Hour), nil)

	service := notification.NewService(database)
	if err := service.MarkAllRead(ctx, userID, now); err != nil {
		t.Fatalf("MarkAllRead() error = %v", err)
	}
	if err := service.MarkAllRead(ctx, userID, now.Add(time.Minute)); err != nil {
		t.Fatalf("idempotent MarkAllRead() error = %v", err)
	}

	var unreadForUser int
	if err := database.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL`, userID).Scan(&unreadForUser); err != nil {
		t.Fatal(err)
	}
	if unreadForUser != 0 {
		t.Fatalf("unread notifications for marked user = %d, want 0", unreadForUser)
	}

	var unreadForOtherUser int
	if err := database.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL`, otherUserID).Scan(&unreadForOtherUser); err != nil {
		t.Fatal(err)
	}
	if unreadForOtherUser != 1 {
		t.Fatalf("unread notifications for other user = %d, want 1", unreadForOtherUser)
	}
}
