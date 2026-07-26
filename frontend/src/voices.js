// Theme-aware copy. Each theme has its own "voice" — the same event reads
// differently depending on the viewer's active theme, the same way the
// colors and fonts already do. Keep ids in sync with themes.js.

export const VOICES = {
  voyage: {
    systemMessage: {
      member_added: (actor, target) => `${target} has joined the crew, welcomed aboard by ${actor}! ⚓`,
      member_kicked: (actor, target) => `${target} was cast overboard by ${actor} 💦`,
      member_promoted: (actor, target) => `${target} was made First Mate by ${actor}! ⚓`,
      member_demoted: (actor, target) => `${target} was relieved of First Mate duty by ${actor}.`,
    },
    emptyDm: "No messages yet — chart a course and say hello!",
    emptyGroups: "No crews yet — found one and set sail!",
    emptyConversations: "Your logbook is empty. Start a voyage with a friend!",
    emptyPosts: "No voyages logged yet.",
    joinListening: "⚓ Join the Voyage",
  },
  requiem: {
    systemMessage: {
      member_added: (actor, target) => `${target} was drawn into the fold by ${actor}.`,
      member_kicked: (actor, target) => `${target} was banished from the fold by ${actor}.`,
      member_promoted: (actor, target) => `${target} was raised to a seat of power by ${actor}.`,
      member_demoted: (actor, target) => `${target} was cast down from power by ${actor}.`,
    },
    emptyDm: "Silence. Not a word has been spoken here yet.",
    emptyGroups: "No covenants formed yet.",
    emptyConversations: "No souls have reached out yet.",
    emptyPosts: "Nothing left behind here... yet.",
    joinListening: "🌙 Join the Requiem",
  },
  "shadow-leaf": {
    systemMessage: {
      member_added: (actor, target) => `${target} was recruited to the squad by ${actor} 🍃`,
      member_kicked: (actor, target) => `${target} vanished like a shadow clone, removed by ${actor} 💨`,
      member_promoted: (actor, target) => `${target} was promoted to squad captain by ${actor}! 🍃`,
      member_demoted: (actor, target) => `${target} stepped down as squad captain, by order of ${actor}.`,
    },
    emptyDm: "No messages yet — break the silence!",
    emptyGroups: "No squads yet — form your own!",
    emptyConversations: "No missions in your queue — reach out to your squad!",
    emptyPosts: "No missions recorded yet.",
    joinListening: "🍃 Join the Squad",
  },
};

export function getVoice(themeId) {
  return VOICES[themeId] || VOICES.voyage;
}

// Renders a system message using structured meta + the viewer's own theme voice,
// falling back to the plain-text content for older messages saved before meta existed.
export function renderSystemMessage(message, themeId) {
  const voice = getVoice(themeId);
  const template = message.meta?.eventType ? voice.systemMessage[message.meta.eventType] : null;
  if (template && message.meta) {
    return template(message.meta.actorUsername, message.meta.targetUsername);
  }
  return message.content;
}
