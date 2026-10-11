jest.mock("@/database/repositories", () => ({
	repositories: {
		channels: {
			findById: jest.fn(),
			findByName: jest.fn(),
		},
	},
}));
jest.mock("@/apps/middelware/authenticator", () => ({ authenticateApp: jest.fn() }));
jest.mock(
	"@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver",
	() => ({ resolveSlackIds: jest.fn() }),
);
jest.mock("@/bots/unified/services/unified-dm-service", () => ({
	unifiedDMService: { getOrCreateBotDM: jest.fn() },
}));

import { repositories } from "@/database/repositories";
import { resolveSlackChannel } from "../middleware";

const findById = repositories.channels.findById as jest.Mock;
const findByName = repositories.channels.findByName as jest.Mock;

describe("resolveSlackChannel", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		findById.mockResolvedValue(null);
		findByName.mockResolvedValue(null);
	});

	it("resolves a channel id directly", async () => {
		findById.mockResolvedValue({ id: "chan-1" });
		await expect(resolveSlackChannel("chan-1")).resolves.toBe("chan-1");
		expect(findByName).not.toHaveBeenCalled();
	});

	it("resolves a bare channel name", async () => {
		findByName.mockResolvedValue({ id: "chan-2" });
		await expect(resolveSlackChannel("kotak-acq-swat")).resolves.toBe("chan-2");
		expect(findByName).toHaveBeenCalledWith("kotak-acq-swat");
	});

	it("strips a leading # from Slack-style channel names", async () => {
		findByName.mockResolvedValue({ id: "chan-3" });
		await expect(resolveSlackChannel("#kotak-acq-swat")).resolves.toBe("chan-3");
		expect(findByName).toHaveBeenCalledWith("kotak-acq-swat");
	});

	it("strips only one leading #", async () => {
		await expect(resolveSlackChannel("##weird")).rejects.toThrow("Channel not found");
		expect(findByName).toHaveBeenCalledWith("#weird");
	});

	it("rejects a bare # without a name lookup", async () => {
		await expect(resolveSlackChannel("#")).rejects.toThrow("Channel not found");
		expect(findByName).not.toHaveBeenCalled();
	});

	it("throws channel not found when nothing matches", async () => {
		await expect(resolveSlackChannel("#missing")).rejects.toThrow("Channel not found");
	});
});
