/* eslint-disable require-jsdoc */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

exports.nearbyRestaurants = functions.https
    .onRequest(async (req, res) => {
      const qLat = req.query.lat;
      const qLng = req.query.lng;
      const qRadius = req.query.radius;
      if (!qLat || !qLng || !qRadius) {
        // eslint-disable-next-line max-len
        res.status(400).send({status: "FAILED", msg: "Todos los parametros son necesarios"});
        return;
      }
      if (isNaN(qLat) || isNaN(qLng) || isNaN(qRadius)) {
        // eslint-disable-next-line max-len
        res.status(400).send({status: "FAILED", msg: "Los parámetros deben ser numéricos"});
        return;
      }
      const R = 6371;
      const latUser = parseFloat(qLat);
      const lngUser = parseFloat(qLng);
      const radius = parseFloat(qRadius);
      if (radius<3 || radius>20) {
        // eslint-disable-next-line max-len
        res.status(400).send({status: "FAILED", msg: "El radio debe ser entre 3 a 20 km"});
        return;
      }
      let nearbyRestaurants = [];
      const restaurants = await db.collection("restaurants").get();
      restaurants.docs.forEach((doc) => {
        const dLat = deg2rad(doc.data().geoPoint.latitude-latUser);
        const dLon = deg2rad(doc.data().geoPoint.longitude-lngUser);
        // eslint-disable-next-line max-len
        const a =Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(latUser)) * Math.cos(deg2rad(doc.data().geoPoint.latitude)) *Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = R * c; // Distance in km
        if (d<=radius) {
          const restaurant = doc.data();
          restaurant.key = doc.id;
          restaurant.distance = d;
          nearbyRestaurants.push(restaurant);
        }
      });
      // eslint-disable-next-line max-len
      nearbyRestaurants = nearbyRestaurants.sort(({distance: a}, {distance: b}) => a-b);
      res.status(200).send({status: "OK", restaurants: nearbyRestaurants});
    });

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

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
