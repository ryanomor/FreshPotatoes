const sqlite = require("sqlite"),
  Sequelize = require("sequelize"),
  request = require("request"),
  express = require("express"),
  app = express();

const {
  PORT = 3000,
  NODE_ENV = "development",
  DB_PATH = "./db/database.db",
  API_URL = "http://credentials-api.generalassemb.ly/4576f55f-c427-4cfc-a11c-5bfe914ca6c1"
} = process.env;

// START SERVER
Promise.resolve()
  .then(() =>
    app.listen(PORT, () => console.log(`App listening on port ${PORT}`))
  )
  .catch(err => {
    if (NODE_ENV === "development") console.error(err.stack);
  });

// Initalize sequelize
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: DB_PATH
});

sequelize
  .authenticate()
  .then(() => {
    console.log("Database connected.");
  })
  .catch(err => {
    console.log("Error connecting to database", err);
  });

// Define film model
const Films = sequelize.define("film", {
  id: { type: Sequelize.INTEGER, primaryKey: true },
  title: Sequelize.STRING,
  release_date: Sequelize.DATE,
  genre_id: Sequelize.INTEGER,
  average_rating: Sequelize.INTEGER,
  reviews: Sequelize.INTEGER
});

// Define genre model
const Genres = sequelize.define("genre", {
  id: { type: Sequelize.INTEGER, primaryKey: true },
  name: Sequelize.STRING
});

// ROUTES

app.get("/films/:id/recommendations", getFilmRecommendations);

// Handle invalid routes
app.get("*", (req, res) => {
  const error = new Error("invalid route");
  res.status(404).send({ message: error });
  return;
});

// ROUTE HANDLER
function getFilmRecommendations(req, res) {
  const limit = req.query.limit || 10;
  const offset = req.query.offset || 0;

  const FILM_ID = req.params.id;

  if (isNaN(FILM_ID)) {
    const error = new Error("invalid id");
    res.status(422).send({ message: error });
    return;
  } else if (isNaN(limit) || isNaN(offset)) {
    const error = new Error("invalid query params");
    res.status(422).send({ message: error });
    return;
  }

  let response = {
    recommendations: [],
    meta: {
      limit: limit,
      offset: offset
    }
  };

  // Get film by ID
  let currFilm;
  Films.findById(FILM_ID).then(film => {
    if (!film) {
      const error = new Error("Film id doesn't exist");
      res.status(422).send({ message: error });
      return;
    }

    currFilm = film;
  });
  
  // Get film genre from db
  Genres.findById(currFilm.genre_id).then(genre => {
    if (!genre) {
      const error = new Error("Error finding genre");
      res.status(422).send({ message: error });
      return;
    }

    let dateRangeStart = new Date(currFilm.release_date);
    dateRangeStart.setFullYear(-15 + dateRangeStart.getFullYear());
    let dateRangeEnd = new Date(currFilm.release_date);
    dateRangeEnd.setFullYear(15 + dateRangeEnd.getFullYear());

    // Fetch all films matching query genre from db
    return Films.findAll({
      attributes: ["id", "title", "release_date"],
      where: {
        genre_id: genre.id,
        release_date: { $between: [dateRangeStart, dateRangeEnd] }
      },
      raw: true
    }).then(totalFilms => {
        // Create array of film ids
        const ids = totalFilms.map(film => film.id);

        // Get reviews for films from 3rd Party API
        const sortedRecommendationIds = request(
          { url: API_URL + "?films=" + ids.join(",") },
          (err, res, body) => {
            if (err) {
              return next(err);
            }

            // Filter recommendations by rating quantity/quality
            const averageRating = film => {
              let ratingsSum = 0;
              film.reviews.forEach(review => {
                ratingsSum += review.rating;
              });
              return (
                Math.round(ratingsSum / film.reviews.length * 100, 1) / 100
              );
            };

            let allReviews = JSON.parse(body);

            // Filter films with at least 5 reviews & over 4.0 ratings. Add data to response
            allReviews
              .filter(film => film.reviews.length >= 5 && averageRating(film) > 4.0)
              .map(film => {
                let dbData = totalFilms.find(data => film.film_id === data.id);

                response.recommendations.push({
                  id: film.film_id,
                  title: dbData.title,
                  releaseDate: dbData.release_date,
                  genre: genre.name,
                  averageRating: averageRating(film),
                  reviews: film.reviews.length
                });
              }).sort((a, b) => a.id - b.id);
          }
        );
      })
      .catch(err => {
        res.status(422).send({ message: err });
      });
  });

  res.status(200).json(response);
}

module.exports = app;
