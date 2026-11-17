// These are the QuickPizza payload shapes this project reads and sends.

export interface User {
  username: string;
  password: string;
}

export interface Restrictions {
  maxCaloriesPerSlice: number;
  mustBeVegetarian: boolean;
  excludedIngredients: string[];
  excludedTools: string[];
  maxNumberOfToppings: number;
  minNumberOfToppings: number;
}

export interface Recommendation {
  pizza: { id: number; name: string };
  calories: number;
  vegetarian: boolean;
}

export interface Rating {
  id: number;
  stars: number;
  pizza_id: number;
}

// This is what setup() hands to every VU and teardown().
export interface SetupData {
  users: User[];
}
