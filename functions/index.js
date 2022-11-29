/* eslint-disable require-jsdoc */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

exports.createRestaurantUser = functions.firestore
    .document("restaurants/{uid}")
    .onCreate((snap, context)=>{
      const userObject = {
        permisos: "Restaurant",
      };
      return admin.firestore().doc("users/"+context.params.uid).set(userObject);
    });

exports.aggregateRating = functions.firestore
    .document("restaurants/{restId}/reviews/{reviewId}")
    .onCreate(async (snap, context) => {
      // Get value of the newly added rating
      const ratingVal = snap.data().rating;

      // Get a reference to the restaurant
      const restRef = db.collection("restaurants").doc(context.params.restId);

      // Update aggregations in a transaction
      await db.runTransaction(async (transaction) => {
        const restDoc = await transaction.get(restRef);

        // Compute new number of ratings
        const newNumReviews = restDoc.data().numReviews + 1;

        // Compute new average rating
        // eslint-disable-next-line max-len
        const oldRatingTotal = restDoc.data().rating * restDoc.data().numReviews;
        const newRating = (oldRatingTotal + ratingVal) / newNumReviews;

        // Update restaurant info
        transaction.update(restRef, {
          rating: newRating,
          numReviews: newNumReviews,
        });
      });
    });

exports.updateRating = functions.firestore
    .document("restaurants/{restId}/reviews/{reviewId}")
    .onUpdate(async (change, context) => {
      // Get value of the newly added rating
      const oldRatingVal = change.before.data().rating;
      const newRatingVal = change.after.data().rating;

      // Get a reference to the restaurant
      const restRef = db.collection("restaurants").doc(context.params.restId);

      // Update aggregations in a transaction
      await db.runTransaction(async (transaction) => {
        const restDoc = await transaction.get(restRef);

        // Compute new average rating
        // eslint-disable-next-line max-len
        const oldRatingTotal = restDoc.data().rating * restDoc.data().numReviews;
        // eslint-disable-next-line max-len
        const newRating = (oldRatingTotal + newRatingVal - oldRatingVal) / restDoc.data().numReviews;

        // Update restaurant info
        transaction.update(restRef, {
          rating: newRating,
        });
      });
    });

exports.deleteRating = functions.firestore
    .document("restaurants/{restId}/reviews/{reviewId}")
    .onDelete(async (snap, context) => {
      // Get value of the newly added rating
      const ratingVal = snap.data().rating;

      // Get a reference to the restaurant
      const restRef = db.collection("restaurants").doc(context.params.restId);

      // Update aggregations in a transaction
      await db.runTransaction(async (transaction) => {
        const restDoc = await transaction.get(restRef);

        // Compute new number of ratings
        let newNumReviews = restDoc.data().numReviews - 1;

        // Compute new average rating
        // eslint-disable-next-line max-len
        const oldRatingTotal = restDoc.data().rating * restDoc.data().numReviews;
        let newRating;

        if (newNumReviews <= 0) {
          newNumReviews = 0;
          newRating = 0;
        } else {
          newRating = (oldRatingTotal - ratingVal) / newNumReviews;
        }
        // Update restaurant info
        transaction.update(restRef, {
          rating: newRating,
          numReviews: newNumReviews,
        });
      });
    });

exports.deleteRestaurant = functions.firestore
    .document("restaurants/{restId}")
    .onDelete(async (snap, context) => {
      // Get value of the newly added rating
      await deleteReviewsCollection(db, context.params.restId, 200);
    });


async function deleteReviewsCollection(db, restaurantId, batchSize) {
  // eslint-disable-next-line max-len
  const collectionRef = db.collection("restaurants").document(restaurantId).collection("reviews");
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
  // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Recurse on the next process tick, to avoid
  // exploding the stack.
  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}
