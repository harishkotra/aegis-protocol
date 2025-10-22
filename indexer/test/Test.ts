import assert from "assert";
import { 
  TestHelpers,
  AegisPactFactory_PactCreated
} from "generated";
const { MockDb, AegisPactFactory } = TestHelpers;

describe("AegisPactFactory contract PactCreated event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for AegisPactFactory contract PactCreated event
  const event = AegisPactFactory.PactCreated.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("AegisPactFactory_PactCreated is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await AegisPactFactory.PactCreated.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualAegisPactFactoryPactCreated = mockDbUpdated.entities.AegisPactFactory_PactCreated.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedAegisPactFactoryPactCreated: AegisPactFactory_PactCreated = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      owner: event.params.owner,
      pactAddress: event.params.pactAddress,
      beneficiary: event.params.beneficiary,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualAegisPactFactoryPactCreated, expectedAegisPactFactoryPactCreated, "Actual AegisPactFactoryPactCreated should be the same as the expectedAegisPactFactoryPactCreated");
  });
});
