package image

import (
	"encoding/base64"
	"testing"
)

func validPrivateUpload(contentType string) UploadInput {
	return UploadInput{
		Visibility:        "private",
		ContentType:       contentType,
		Nonce:             base64.RawURLEncoding.EncodeToString(make([]byte, 12)),
		Algorithm:         PhotoAlgorithm,
		KeyVersion:        PhotoKeyVersion,
		WrappedImageKey:   base64.RawURLEncoding.EncodeToString(make([]byte, wrappedImageKeyBytes)),
		AccountWrappedKey: base64.RawURLEncoding.EncodeToString(make([]byte, wrappedImageKeyBytes)),
		DeviceID:          "device-test",
		WrappingAlgorithm: InitialImageWrappingAlgorithm,
	}
}

func TestValidateUploadAllowsRasterImageContentTypes(t *testing.T) {
	for _, contentType := range []string{"application/octet-stream", "image/jpeg", "image/png", "image/webp"} {
		if err := validateUpload(validPrivateUpload(contentType), nil); err != nil {
			t.Errorf("validateUpload(%q) error = %v", contentType, err)
		}
	}
}

func TestValidateUploadRejectsBrowserInterpretedContentTypes(t *testing.T) {
	for _, contentType := range []string{"image/svg+xml", "text/html", "image/gif", "image/heic"} {
		if err := validateUpload(validPrivateUpload(contentType), nil); err != ErrInvalidPhoto {
			t.Errorf("validateUpload(%q) error = %v, want %v", contentType, err, ErrInvalidPhoto)
		}
	}
}
