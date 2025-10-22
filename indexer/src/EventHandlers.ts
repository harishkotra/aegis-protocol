import { AegisPactFactory, AegisPact, Pact } from "generated";

// 1. Register new AegisPact contracts as they are created by the factory
AegisPactFactory.PactCreated.contractRegister(({ event, context }) => {
  context.addAegisPact(event.params.pactAddress);
  context.log.info(`Registered new AegisPact at ${event.params.pactAddress}`);
});

// 2. Handler for the PactCreated event from the factory
AegisPactFactory.PactCreated.handler(async ({ event, context }) => {
  // Create a new Pact entity in the database.
  // Only use event params and block metadata here.
  const newPact: Pact = {
    id: event.params.pactAddress,
    owner: event.params.owner,
    beneficiary: event.params.beneficiary,
    // The following fields are not available directly from the event or block.
    // If you need to fetch them from the contract, use the Effect API.
    // For now, set them to null or a default value.
    warden: "", // or a default address if you have one
    checkInInterval: 0n, // or another default value
    protectedToken: "", // or a default address if you have one
    lastCheckIn: BigInt(event.block.timestamp),
    createdAt: BigInt(event.block.timestamp),
  };
  context.Pact.set(newPact);
});

// 3. Handler for the CheckedIn event from any dynamically discovered AegisPact contract
AegisPact.CheckedIn.handler(async ({ event, context }) => {
  const pact = await context.Pact.get(event.srcAddress);
  if (!pact) {
    context.log.error(`Pact with address ${event.srcAddress} not found.`);
    return;
  }
  const updatedPact: Pact = {
    ...pact,
    lastCheckIn: event.params.timestamp,
  };
  context.Pact.set(updatedPact);
});