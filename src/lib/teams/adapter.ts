/**
 * Bot Framework adapter for the Teams channel.
 *
 * We deliberately never call `CloudAdapter.process(req, res, logic)` — that
 * signature wants Node-style req/res objects, which the Next.js App Router
 * doesn't hand us. Instead we use `processActivityDirect(authHeader, activity,
 * logic)`, which takes the raw Authorization header + parsed Activity body
 * and does the same JWT validation internally. Outbound replies go through
 * `continueConversationAsync`, a proactive send authenticated with the bot's
 * own app credentials — exactly what an async ("ack fast, reply later")
 * architecture needs, since the original request is long gone by the time
 * George has a reply.
 */
import {
  CloudAdapter,
  TurnContext,
  type Activity,
  type ConversationReference,
} from "botbuilder";
import {
  AuthenticationConfiguration,
  BotFrameworkAuthenticationFactory,
  PasswordServiceClientCredentialFactory,
} from "botframework-connector";

function buildAdapter(): CloudAdapter {
  const appId = process.env.TEAMS_APP_ID;
  const appPassword = process.env.TEAMS_APP_PASSWORD;
  // The bot's OWN home tenant (AIXccelerate) — only set if the Entra app
  // registration is SingleTenant. Deliberately a different env var from
  // TEAMS_ALLOWED_TENANT_ID, which is Onyx's tenant and is used purely for
  // the inbound tenant gate in tenant-gate.ts. Conflating the two would mean
  // a multi-tenant app registration (the recommended setup, so Onyx's Teams
  // admin can sideload the bot without any cross-tenant AAD consent) trying
  // to fetch its own token scoped to Onyx's tenant, which fails.
  const appTenantId = process.env.TEAMS_APP_TENANT_ID;

  if (!appId || !appPassword) {
    throw new Error(
      "[teams] TEAMS_APP_ID / TEAMS_APP_PASSWORD are not set — cannot build the Bot Framework adapter.",
    );
  }

  const credentialFactory = appTenantId
    ? new PasswordServiceClientCredentialFactory(appId, appPassword, appTenantId)
    : new PasswordServiceClientCredentialFactory(appId, appPassword);

  // Leaving channelService / the parameterized URL args nil (cast below,
  // since the public .d.ts overloads don't model this) hits
  // BotFrameworkAuthenticationFactory's built-in public-cloud defaults —
  // verified against the library source — rather than us hand-typing
  // login/token/OpenID URLs ourselves.
  const create = BotFrameworkAuthenticationFactory.create as (
    ...args: unknown[]
  ) => ReturnType<typeof BotFrameworkAuthenticationFactory.create>;
  const botFrameworkAuthentication = create(
    undefined,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    credentialFactory,
    new AuthenticationConfiguration(),
  );

  return new CloudAdapter(botFrameworkAuthentication);
}

let cached: CloudAdapter | null = null;

export function getTeamsAdapter(): CloudAdapter {
  cached ??= buildAdapter();
  return cached;
}

/**
 * Authenticates and runs `logic` for one inbound Teams activity. Throws if
 * the auth header doesn't check out (bad/missing JWT, wrong app id, etc) —
 * callers should treat any throw as "reject the request."
 */
export async function runTeamsActivity(
  authHeader: string,
  activity: Activity,
  logic: (context: TurnContext) => Promise<void>,
): Promise<void> {
  await getTeamsAdapter().processActivityDirect(authHeader, activity, logic);
}

/**
 * Sends a proactive reply into an existing Teams conversation, identified by
 * the `ConversationReference` captured off the inbound activity
 * (`TurnContext.getConversationReference(activity)`). Used from the async
 * event processor, well after the original HTTP request has ended.
 */
export async function sendTeamsReply(
  conversationReference: Partial<ConversationReference>,
  text: string,
): Promise<void> {
  const appId = process.env.TEAMS_APP_ID;
  if (!appId) {
    throw new Error("[teams] TEAMS_APP_ID is not set — cannot send a reply.");
  }
  await getTeamsAdapter().continueConversationAsync(
    appId,
    conversationReference,
    async (turnContext) => {
      await turnContext.sendActivity(text);
    },
  );
}

export { TurnContext };
export type { Activity, ConversationReference };
