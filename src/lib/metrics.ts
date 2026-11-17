import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// One of each custom metric type; Trend uses time values so the summary prints durations.
// This tracks how long the recommendation endpoint feels to the user.
export const recommendationDuration = new Trend('pizza_recommendation_duration', true);

// Business-level counters sit next to the raw request counts.
export const pizzasRecommended = new Counter('pizzas_recommended');
export const ratingsSubmitted = new Counter('ratings_submitted');

// This is the share of recommendations that passed content validation, not just a 200.
export const recommendationValid = new Rate('recommendation_valid');

// This keeps the latest value for live dashboards.
export const lastCalories = new Gauge('last_recommended_calories');
