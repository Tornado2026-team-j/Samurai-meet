package meeting

import (
	"errors"
	"math"
	"testing"
)

func TestValidateProximityAcceptsOnlyBoundedClientEstimates(t *testing.T) {
	valid := ProximityInput{Method: "bluetooth_rssi", DistanceM: 2.5, Confidence: 0.8, SampleID: "sample-1"}
	if err := validateProximity(valid); err != nil {
		t.Fatalf("valid proximity rejected: %v", err)
	}
	for _, test := range []struct {
		name  string
		input ProximityInput
	}{
		{name: "unknown method", input: ProximityInput{Method: "raw_ble", DistanceM: 1, Confidence: 1, SampleID: "s"}},
		{name: "nan distance", input: ProximityInput{Method: "bluetooth_rssi", DistanceM: math.NaN(), Confidence: 1, SampleID: "s"}},
		{name: "confidence over one", input: ProximityInput{Method: "location_inference", DistanceM: 1, Confidence: 1.1, SampleID: "s"}},
		{name: "empty sample", input: ProximityInput{Method: "bluetooth_uwb", DistanceM: 1, Confidence: 0.5}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateProximity(test.input); !errors.Is(err, ErrMeetingInvalidInput) {
				t.Fatalf("error = %v, want ErrMeetingInvalidInput", err)
			}
		})
	}
}
