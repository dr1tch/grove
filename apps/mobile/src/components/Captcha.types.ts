export type CaptchaProps = {
  url: string;
  attempt: number;
  dark: boolean;
  onToken: (token: string) => void;
};
