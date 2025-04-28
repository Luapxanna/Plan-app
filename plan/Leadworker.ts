import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Lead } from "./lead";
import { api } from "encore.dev/api";

// Free tier optimized configuration
const BATCH_SIZE = 10; // Maximum messages to process at once
const POLL_INTERVAL = 20000; // 20 seconds between polls (reduces API calls)
const VISIBILITY_TIMEOUT = 30; // 30 seconds visibility timeout

// Use free tier region
const region = "us-east-1";
const sqs = new SQSClient({
    region,
    // Use default credential provider chain
    // This will look for credentials in:
    // 1. Environment variables
    // 2. AWS credentials file
    // 3. AWS IAM role
});

// Get queue URLs
const queueUrl = "https://sqs.us-east-1.amazonaws.com/929223012365/lead-new-queue";
const dlqUrl = "https://sqs.us-east-1.amazonaws.com/929223012365/lead-new-dlq";

if (!queueUrl) {
    console.warn("LEAD_NEW_QUEUE_URL not set. Worker will not start.");
    process.exit(1);
}

// Track API usage for free tier monitoring
let apiCalls = 0;
let startTime = Date.now();

function logApiUsage() {
    const elapsedHours = (Date.now() - startTime) / (1000 * 60 * 60);
    const callsPerHour = apiCalls / elapsedHours;
    const estimatedMonthlyCalls = callsPerHour * 24 * 30;

    console.log(`API Usage Stats:
    - Total Calls: ${apiCalls}
    - Calls/Hour: ${callsPerHour.toFixed(2)}
    - Estimated Monthly Calls: ${estimatedMonthlyCalls.toFixed(0)}
    - Free Tier Limit: 1,000,000
    - Usage Percentage: ${(estimatedMonthlyCalls / 1000000 * 100).toFixed(2)}%
    `);
}

// Function to send a lead to SQS
export async function sendLeadToQueue(lead: Lead): Promise<void> {
    try {
        const command = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(lead),
            MessageAttributes: {
                EventType: {
                    DataType: 'String',
                    StringValue: 'Lead.New'
                }
            }
        });

        apiCalls++;
        await sqs.send(command);
        console.log(`Lead ${lead.id} sent to queue successfully`);
    } catch (error) {
        console.error("Error sending lead to queue:", error);
        throw error;
    }
}

async function pollQueue() {
    console.log("Starting Lead.new worker...");

    while (true) {
        try {
            // Batch receive messages
            const command = new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: BATCH_SIZE,
                WaitTimeSeconds: 20, // Long polling to reduce API calls
                VisibilityTimeout: VISIBILITY_TIMEOUT,
            });

            apiCalls++;
            const response = await sqs.send(command);

            if (response.Messages && response.Messages.length > 0) {
                console.log(`Processing batch of ${response.Messages.length} messages`);

                // Process messages in parallel
                await Promise.all(response.Messages.map(async (message) => {
                    if (!message.Body || !message.ReceiptHandle) {
                        console.error("Invalid message format:", message);
                        return;
                    }

                    try {
                        const lead = JSON.parse(message.Body) as Lead;
                        await handleLeadNew(lead);

                        // Delete processed message
                        const deleteCommand = new DeleteMessageCommand({
                            QueueUrl: queueUrl,
                            ReceiptHandle: message.ReceiptHandle,
                        });
                        apiCalls++;
                        await sqs.send(deleteCommand);
                    } catch (error) {
                        console.error("Error processing message:", error);
                    }
                }));
            }

            // Log API usage periodically
            if (apiCalls % 100 === 0) {
                logApiUsage();
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (error) {
            console.error("Error polling SQS:", error);
            // Exponential backoff on errors
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 2));
        }
    }
}

async function handleLeadNew(lead: Lead) {
    console.log(`Processing new lead: ${lead.name} (${lead.email})`);

    // Example processing steps:
    // 1. Log the lead
    console.log("Lead details:", {
        id: lead.id,
        workspace: lead.workspace_id,
        user: lead.user_id,
        contact: {
            name: lead.name,
            email: lead.email,
            phone: lead.phone
        },
        created: lead.created_at
    });

    // 2. Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Log completion
    console.log(`Finished processing lead: ${lead.name}`);
}

// Test endpoint to manually send events with failure simulation
export const sendTestEvent = api(
    { expose: true, method: "POST", path: "/dev/sendEvent" },
    async ({ shouldFail = true }: { shouldFail?: boolean } = {}): Promise<{ message: string }> => {
        try {
            const testLead: Lead = {
                id: "test-" + Date.now(),
                workspace_id: "test-workspace",
                user_id: "test-user",
                name: "Test Lead",
                email: "test@example.com",
                phone: "1234567890",
                created_at: new Date()
            };

            // Send to main queue with retry attributes
            const command = new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(testLead),
                MessageAttributes: {
                    RetryCount: {
                        DataType: 'Number',
                        StringValue: '0'
                    },
                    ShouldFail: {
                        DataType: 'String',
                        StringValue: shouldFail.toString()
                    }
                }
            });

            await sqs.send(command);
            return {
                message: shouldFail
                    ? "Test event sent to main queue (will fail and retry)"
                    : "Test event sent successfully"
            };
        } catch (error) {
            console.error("Error sending test event:", error);
            throw error;
        }
    }
);

// Process messages with retry logic
async function processMessage(message: any) {
    if (!message.Body || !message.ReceiptHandle) {
        console.error("Invalid message format:", message);
        return;
    }

    const messageId = message.MessageId || 'unknown';
    const retryCount = parseInt(message.MessageAttributes?.RetryCount?.StringValue || "0");
    const shouldFail = message.MessageAttributes?.ShouldFail?.StringValue === "true";

    console.log(`Processing message ${messageId} (attempt ${retryCount + 1})`);

    try {
        const lead = JSON.parse(message.Body) as Lead;

        // Simulate failure based on retry count
        if (shouldFail && retryCount < 3) {
            throw new Error(`Simulated processing failure (attempt ${retryCount + 1})`);
        }

        await handleLeadNew(lead);

        // Success - delete the message
        const deleteCommand = new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
        });
        await sqs.send(deleteCommand);
        console.log(`Successfully processed message ${messageId}`);
    } catch (error) {
        console.error(`Error processing message ${messageId}:`, error);

        if (retryCount >= 3) {
            // Max retries reached - move to DLQ
            console.log(`Message ${messageId} exceeded max retries. Moving to DLQ.`);
            await moveToDLQ(message);
        } else {
            // Update retry count and send back to queue
            const retryCommand = new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: message.Body,
                MessageAttributes: {
                    ...message.MessageAttributes,
                    RetryCount: {
                        DataType: 'Number',
                        StringValue: (retryCount + 1).toString()
                    }
                },
                DelaySeconds: 5 // Add delay between retries
            });
            await sqs.send(retryCommand);
            console.log(`Message ${messageId} queued for retry (attempt ${retryCount + 2})`);
        }
    }
}

// Function to move failed messages to DLQ
async function moveToDLQ(message: any) {
    if (!dlqUrl) {
        console.error("DLQ URL not configured. Message will be lost.");
        return;
    }

    try {
        const command = new SendMessageCommand({
            QueueUrl: dlqUrl,
            MessageBody: message.Body,
            MessageAttributes: {
                OriginalQueue: { DataType: 'String', StringValue: queueUrl },
                ErrorCount: { DataType: 'Number', StringValue: "3" },
                LastError: { DataType: 'String', StringValue: "Simulated processing failure" },
            },
        });
        apiCalls++;
        await sqs.send(command);
        console.log(`Message moved to DLQ: ${message.MessageId}`);
    } catch (error) {
        console.error("Error moving message to DLQ:", error);
    }
}

// Start polling
pollQueue().catch(error => {
    console.error("Fatal error in worker:", error);
    process.exit(1);
});
