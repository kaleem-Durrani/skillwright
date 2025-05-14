import { Conversation, ConversationParticipant, Message } from "@/common/types";

/**
 * Format date for messages
 * @param dateString ISO date string
 * @returns Formatted date string
 */
export const formatMessageDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString();
};

/**
 * Format date for conversation list
 * @param dateString ISO date string
 * @returns Formatted date string
 */
export const formatConversationDate = (dateString: string): string => {
  if (!dateString) return "Unknown date";
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) {
    // Today, show time
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInDays === 1) {
    // Yesterday
    return 'Yesterday';
  } else if (diffInDays < 7) {
    // Within a week, show day name
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    // More than a week, show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
};

/**
 * Get conversation title from participants
 * @param conversation Conversation object
 * @param currentUserId Current user ID
 * @returns Conversation title
 */
export const getConversationTitle = (
  conversation: Conversation,
  currentUserId: string
): string => {
  if (conversation.title) {
    return conversation.title;
  }
  
  // Find other participants (not the current user)
  const otherParticipants = conversation.participants?.filter(
    (p) => p.userId !== currentUserId
  );
  
  if (!otherParticipants || otherParticipants.length === 0) {
    return "Conversation";
  }
  
  return otherParticipants
    .map((p) => p.name || "Unknown")
    .join(", ");
};

/**
 * Get last message preview
 * @param conversation Conversation object
 * @returns Last message preview
 */
export const getLastMessagePreview = (conversation: Conversation): string => {
  if (!conversation.messages || conversation.messages.length === 0) {
    return "No messages yet";
  }
  
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const content = lastMessage.content || "";
  
  return content.length > 30
    ? `${content.substring(0, 30)}...`
    : content;
};

/**
 * Check if a message is from the current user
 * @param message Message object
 * @param currentUserId Current user ID
 * @returns True if the message is from the current user
 */
export const isCurrentUserMessage = (
  message: Message,
  currentUserId: string
): boolean => {
  return message.senderId === currentUserId;
};

/**
 * Group messages by date
 * @param messages Array of messages
 * @returns Grouped messages by date
 */
export const groupMessagesByDate = (messages: Message[]): { date: string; messages: Message[] }[] => {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = '';
  let currentGroup: Message[] = [];

  messages.forEach((message) => {
    const messageDate = new Date(message.createdAt).toLocaleDateString();
    
    if (messageDate !== currentDate) {
      if (currentGroup.length > 0) {
        groups.push({ date: currentDate, messages: currentGroup });
      }
      currentDate = messageDate;
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }
  });

  if (currentGroup.length > 0) {
    groups.push({ date: currentDate, messages: currentGroup });
  }

  return groups;
};

/**
 * Format date header for message groups
 * @param dateString Date string
 * @returns Formatted date header
 */
export const formatDateHeader = (dateString: string): string => {
  const today = new Date().toLocaleDateString();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
  
  if (dateString === today) {
    return 'Today';
  } else if (dateString === yesterday) {
    return 'Yesterday';
  }
  
  return dateString;
};
