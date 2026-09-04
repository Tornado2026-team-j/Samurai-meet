package memorymonster

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/db"
)

func TestListIncludesCollectionDetailFields(t *testing.T) {
	database := openIsolatedTestDatabase(t)
	ctx := context.Background()
	stamp := "2026-09-04T07:12:00Z"

	for _, user := range []struct {
		id     string
		google string
	}{
		{id: "memory-owner", google: "memory-owner-google"},
		{id: "memory-requester", google: "memory-requester-google"},
	} {
		if _, err := database.ExecContext(ctx, `
			INSERT INTO users (id,google_subject_id,status,created_at,updated_at)
			VALUES ($1,$2,'active',$3,$3)`, user.id, user.google, stamp); err != nil {
			t.Fatalf("insert user %q: %v", user.id, err)
		}
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO recruitment_cards (id,owner_user_id,category,available_date,start_time,end_time,timezone,description,location_name,visibility_radius_km,status,expires_at,created_at,updated_at)
		VALUES ('memory-card','memory-owner','Places','2026-08-24','10:00','12:00','Asia/Tokyo','guide','清水寺・祇園',3,'matched',$1,$2,$2)`, stamp, stamp); err != nil {
		t.Fatalf("insert recruitment card: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO matches (id,card_id,requester_user_id,owner_user_id,status,matched_at,created_at,updated_at)
		VALUES ('memory-match','memory-card','memory-requester','memory-owner','completed',$1,$1,$1)`, stamp); err != nil {
		t.Fatalf("insert match: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO photos (id,owner_user_id,visibility,storage_path,cipher_sha256,nonce,algorithm,key_version,wrapped_image_key,wrapping_algorithm,created_at,content_type,size_bytes,account_wrapped_image_key)
		VALUES ('memory-photo','memory-owner','private','memory-owner/memory-photo.bin',$1,'nonce','AES-256-GCM','v1','wrapped','KEY-B-AES-GCM',$2,'image/webp',128,'account-wrapped')`,
		hex.EncodeToString(make([]byte, 32)), stamp); err != nil {
		t.Fatalf("insert source photo: %v", err)
	}
	if _, err := database.ExecContext(ctx, `
		INSERT INTO memory_monsters (id,owner_user_id,match_id,source_photo_id,memorable_object,memory_text,prompt_version,provider,generated_storage_path,generated_content_type,created_at)
		VALUES ('memory-monster','memory-owner','memory-match','memory-photo','抹茶アイス','一緒に歩いた','memory-monster-v1','test','memory-monsters/memory-owner/memory-monster.png','image/png',$1)`, stamp); err != nil {
		t.Fatalf("insert memory monster: %v", err)
	}

	items, err := NewService(database, nil, nil).List(ctx, "memory-owner", 10)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("List() length = %d, want 1", len(items))
	}
	item := items[0]
	if item.GuideDate != "2026-08-24" || item.LocationName != "清水寺・祇園" || item.SourcePhotoContentType != "image/webp" {
		t.Fatalf("collection detail fields = %#v", item)
	}
}

func openIsolatedTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("TEST_POSTGRES") != "1" {
		t.Skip("PostgreSQL integration test requires TEST_POSTGRES=1")
	}
	base := config.DatabaseConfig{
		Host:     os.Getenv("DB_HOST"),
		Port:     os.Getenv("DB_PORT"),
		Name:     os.Getenv("DB_NAME"),
		User:     os.Getenv("DB_USER"),
		Password: os.Getenv("DB_PASSWORD"),
		SSLMode:  os.Getenv("DB_SSLMODE"),
		Schema:   "public",
	}
	ctx := context.Background()
	admin, err := db.Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })

	rawSchema := make([]byte, 8)
	if _, err := rand.Read(rawSchema); err != nil {
		t.Fatal(err)
	}
	schema := "memorymonster_test_" + hex.EncodeToString(rawSchema)
	if _, err := admin.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.ExecContext(ctx, `DROP SCHEMA "`+schema+`" CASCADE`) })

	isolatedConfig := base
	isolatedConfig.Schema = schema
	database, err := db.Open(ctx, isolatedConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := db.ApplyMigrations(ctx, database, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}
	return database
}
