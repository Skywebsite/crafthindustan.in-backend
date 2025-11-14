import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Get user's wishlist from Firestore
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of wishlist items
 */
export const getUserWishlist = async (userId) => {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      return userDoc.data().wishlist || [];
    }
    return [];
  } catch (error) {
    console.error("Error getting wishlist:", error);
    return [];
  }
};

/**
 * Add item to user's wishlist
 * @param {string} userId - User ID
 * @param {Object} product - Product object to add
 * @returns {Promise<Object>} Result object
 */
export const addToWishlist = async (userId, product) => {
  try {
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      return {
        success: false,
        error: "User document not found"
      };
    }

    const currentWishlist = userDoc.data().wishlist || [];
    
    // Check if product already exists
    if (currentWishlist.some(item => item.id === product.id)) {
      return {
        success: false,
        error: "Product already in wishlist"
      };
    }

    await updateDoc(userRef, {
      wishlist: arrayUnion(product)
    });

    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Remove item from user's wishlist
 * @param {string} userId - User ID
 * @param {string} productId - Product ID to remove
 * @returns {Promise<Object>} Result object
 */
export const removeFromWishlist = async (userId, productId) => {
  try {
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      return {
        success: false,
        error: "User document not found"
      };
    }

    const currentWishlist = userDoc.data().wishlist || [];
    const updatedWishlist = currentWishlist.filter(item => item.id !== productId);

    await updateDoc(userRef, {
      wishlist: updatedWishlist
    });

    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check if product is in user's wishlist
 * @param {string} userId - User ID
 * @param {string} productId - Product ID to check
 * @returns {Promise<boolean>} True if product is in wishlist
 */
export const isInWishlist = async (userId, productId) => {
  try {
    const wishlist = await getUserWishlist(userId);
    return wishlist.some(item => item.id === productId);
  } catch (error) {
    console.error("Error checking wishlist:", error);
    return false;
  }
};

