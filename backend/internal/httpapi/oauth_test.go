package httpapi

import "testing"

func TestAllowedAppRedirectURI(t *testing.T) {
	tests := []struct {
		name        string
		uri         string
		environment string
		allowExpo   bool
		want        bool
	}{
		{name: "production fixed scheme", uri: "samuraimeet://auth", environment: "production", want: true},
		{name: "production rejects Expo Go by default", uri: "exp://192.168.0.10:8081/--/auth", environment: "production", want: false},
		{name: "local production tunnel allows explicit Expo Go flag", uri: "exp://192.168.0.10:8081/--/auth?channel=dev", environment: "production", allowExpo: true, want: true},
		{name: "development allows Expo Go", uri: "exp://192.168.0.10:8081/--/auth", environment: "development", want: true},
		{name: "wrong path rejected", uri: "exp://192.168.0.10:8081/--/other", environment: "development", want: false},
		{name: "web URL rejected", uri: "https://attacker.example/auth", environment: "development", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := allowedAppRedirectURI(tt.uri, tt.environment, tt.allowExpo); got != tt.want {
				t.Fatalf("allowedAppRedirectURI(%q, %q, %v) = %v, want %v", tt.uri, tt.environment, tt.allowExpo, got, tt.want)
			}
		})
	}
}
