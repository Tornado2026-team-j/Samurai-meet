export type GuideApplicationStatus = "pending" | "accepted" | "declined";

export type GuideApplication = {
  id: string;
  recruitmentId: string;
  matchId: string;
  applicantName: string;
  applicantCountry: string;
  bio: string;
  status: GuideApplicationStatus;
};
