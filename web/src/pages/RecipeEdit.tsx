import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Recipe, RecipeDraft } from '../types';
import RecipeEditor from '../components/RecipeEditor';

export const EMPTY_DRAFT: RecipeDraft = {
  name: '',
  description: null,
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: null,
  source_url: null,
  source_name: null,
  notes: null,
  tags: [],
  ingredients: [],
  steps: [],
};

export default function RecipeEdit() {
  const { id } = useParams();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) api.getRecipe(id).then(setRecipe).catch((e) => setError(e.message));
  }, [id]);

  if (!id) {
    return (
      <div>
        <h1>New recipe</h1>
        <RecipeEditor initial={EMPTY_DRAFT} />
      </div>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!recipe) return <p className="muted">Loading…</p>;
  return (
    <div>
      <h1>Edit recipe</h1>
      <RecipeEditor initial={recipe} recipe={recipe} />
    </div>
  );
}
