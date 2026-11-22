jest.mock("../../src/lib/mailer", () => ({
  sendMail: jest.fn(),
  trySendMail: jest.fn(),
  verifyMailer: jest.fn(),
}));
