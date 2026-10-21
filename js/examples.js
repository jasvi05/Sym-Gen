/* examples.js - sample programs shown in the dropdown */
const EXAMPLES = {
  basic: String.raw`#include <stdio.h>

int globalCount = 0;

int add(int a, int b) {
    int sum = a + b;
    return sum;
}

int main() {
    int x = 5;
    float y = 3.14;
    char grade = 'A';

    x = add(x, globalCount);
    printf("%d", x);
    return 0;
}
`,

  nested: String.raw`#include <stdio.h>

int main() {
    int x = 5;
    int arr[10];

    if (x > 0) {
        int localFlag = 1;
        x = x + localFlag;
    }

    for (int i = 0; i < 10; i++) {
        arr[i] = i * 2;
    }

    {
        int x = 99;      /* shadows the outer x */
        arr[0] = x;
    }

    return 0;
}
`,

  recursive: String.raw`#include <stdio.h>

int factorial(int n);

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    int result = n * factorial(n - 1);
    return result;
}

int main() {
    int num = 5;
    int ans = factorial(num);
    printf("%d", ans);
    return 0;
}
`,

  types: String.raw`#include <stdio.h>
#define SIZE 8

typedef struct {
    int x;
    int y;
} Point;

enum Color { RED, GREEN, BLUE };

struct Node {
    int value;
    struct Node *next;
};

int main() {
    Point p;
    struct Node n;
    char *name = "demo";
    int table[SIZE];

    p.x = RED;
    n.value = BLUE;
    table[0] = p.x + n.value + name[0];
    return 0;
}
`,

  errors: String.raw`#include <stdio.h>

int total = 0;
int total = 5;               /* redeclaration */

int compute(int a, int b) {
    int unused = 0;          /* never used */
    int a = 3;               /* clashes with parameter a */
    return a + b + missing;  /* undeclared */
}

int main() {
    int x = 1;
    {
        int x = 2;           /* shadows outer x */
        total = x;
    }
    undefinedCall(x);        /* implicit declaration */
    return 0;
}
`,

  blank: ''
};
