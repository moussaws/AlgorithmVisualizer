// server/index.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const esprima = require("esprima");
const estraverse = require("estraverse");

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());
const fs = require('fs');
const util = require('util');
const logFile = fs.createWriteStream('logs.txt', { flags: 'w' }); // 'log.txt' can be any file path
console.log = function () { // redefine console.log to call logFile.write with the same arguments
    logFile.write(util.format.apply(null, arguments) + '\n');
}

app.post("/upload", (req, res) => {
    const fileContent = req.body.fileContent;
    try {
        const context = { variables: {}, history: [], functions: {} };
        context.functions.swap = function(arrayName, index1, index2, line1, line2) {    
            // Perform the first part of the swap
            const temp = context.variables[arrayName][index1];
            context.variables[arrayName][index1] = context.variables[arrayName][index2];
        
            // Capture the state of the array after the first swap line
            const stateAfterFirstSwap = context.variables[arrayName].slice();
            updateHistory(context, line1, 'swap', {
                arrayName: arrayName,
                index1: index1,
                index2: index2,
                arrayState: stateAfterFirstSwap
            });
        
            // Perform the second part of the swap
            context.variables[arrayName][index2] = temp;
        
            // Capture the state of the array after the second swap line
            const stateAfterSecondSwap = context.variables[arrayName].slice();
            if (line2) {
                updateHistory(context, line2, 'swap', {
                    arrayName: arrayName,
                    index1: index1,
                    index2: index2,
                    arrayState: stateAfterSecondSwap
                });
            }
        };
        const ast = esprima.parseScript(fileContent, { loc: true });
        simulateExecution(ast, context);
        res.json({ code: fileContent, history: context.history });
    } catch (error) {
        res.status(400).json({ message: "Error parsing code", error: error.message });
    }
});

function simulateExecution(ast, context) {
    estraverse.traverse(ast, {
        enter: (node, parent) => {
            switch (node.type) {
                case "VariableDeclaration":
                    handleVariableDeclaration(node, context);
                    break;
                case "ForStatement":
                    handleForStatement(node, context);
                    return estraverse.VisitorOption.Skip; // Skip child nodes since we're handling them manually
                case "IfStatement":
                    handleIfStatement(node, context);
                    break;
                // ... handle other node types as needed ...
            }
        }
    });
}



function handleVariableDeclaration(node, context) {
    for (const declarator of node.declarations) {
        // Evaluate the initializer if it exists, otherwise set to `undefined`
        const value = declarator.init ? evaluateExpression(declarator.init, context) : undefined;

        // If the value is an array, create a deep copy for logging
        const loggedValue = Array.isArray(value) ? [...value] : value;

        context.variables[declarator.id.name] = value;
        console.log(`Declared variable ${declarator.id.name} with value:`, loggedValue);

        // Update the history to reflect the variable declaration with the copied value
        updateHistory(context, node.loc.start.line, 'declare-variable', {
            variableName: declarator.id.name,
            initialValue: loggedValue
        });
    }
}


function handleForStatement(node, context) {
    console.log('Entering handleForStatement with node:', node);

    // Handle loop initialization
    if (node.init.type === 'VariableDeclaration') {
        handleVariableDeclaration(node.init, context);
    } else {
        evaluateExpression(node.init, context);
    }

    // Loop structure
    while (true) {
        const testResult = evaluateExpression(node.test, context);
        console.log(`For loop test condition result: ${testResult}`);

        if (!testResult) {
            console.log('Loop test condition is false, exiting loop');
            break;
        }

        console.log('Loop test condition is true, entering loop body with context:', context);
        traverseBlock(node.body, context);

        // Update the loop variable
        evaluateExpression(node.update, context);
        console.log(`Updating loop variable ${node.update.argument.name} to `, context.variables[node.update.argument.name]);

        // Log the loop update
        updateHistory(context, node.update.loc.start.line, 'loop-update', {
            variableName: node.update.argument.name,
            newValue: context.variables[node.update.argument.name]
        });
    }

    // Log the loop end
    updateHistory(context, node.loc.end.line, 'loop-end', null);
}

function handleIfStatement(node, context) {
    const testResult = evaluateExpression(node.test, context);
    updateHistory(context, node.test.loc.start.line, 'if-test', {
        testResult: testResult // Include the result of the test
    });

    if (testResult) {
        // Extract the array name and indices from the node.test expression
        let arrayName, index1, index2;

        // Check if the left-hand side of the test is a MemberExpression
        if (node.test.left && node.test.left.type === 'MemberExpression' &&
            node.test.left.object && node.test.left.object.type === 'Identifier') {
            // The object name is the array name
            arrayName = node.test.left.object.name;
            // The property is the index, which needs to be evaluated
            index1 = evaluateExpression(node.test.left.property, context);
        }

        // Check if the right-hand side of the test is a MemberExpression
        if (node.test.right && node.test.right.type === 'MemberExpression' &&
            node.test.right.object && node.test.right.object.type === 'Identifier' &&
            arrayName === node.test.right.object.name) {
            // The property is the index, which needs to be evaluated
            index2 = evaluateExpression(node.test.right.property, context);
        }

        // If arrayName, index1, and index2 are successfully extracted, perform the swap
        if (arrayName && index1 !== undefined && index2 !== undefined) {
            // Find the line numbers of the swap operations
            let swapLines = node.consequent.body.filter(n => 
                n.type === 'ExpressionStatement' &&
                n.expression.type === 'AssignmentExpression' &&
                n.expression.left.type === 'MemberExpression' &&
                n.expression.left.object.name === arrayName
            ).map(n => n.loc.start.line);

            // Assuming the swap consists of two lines, we log them separately
            if (swapLines.length >= 2) {
                // Call swap with the correct line numbers
                context.functions.swap(arrayName, index1, index2, swapLines[0], swapLines[1]);
            }
        }

        // Then traverse the consequent block if there are more statements to execute
        traverseBlock(node.consequent, context);
    } else if (node.alternate) {
        traverseBlock(node.alternate, context);
    }
}

function traverseBlock(node, context) {
    if (node.type === "BlockStatement") {
        for (const childNode of node.body) {
            simulateExecution(childNode, context);
        }
    } else {
        simulateExecution(node, context);
    }
}

function evaluateExpression(expression, context) {
    console.log('Evaluating expression of type:', expression.type);
    switch (expression.type) {
        case 'Literal':
            return expression.value;
        case 'Identifier':
            return context.variables[expression.name];
        case 'BinaryExpression':
            const left = evaluateExpression(expression.left, context);
            const right = evaluateExpression(expression.right, context);
            console.log(`Evaluating BinaryExpression: ${expression.left.type} ${expression.operator} ${expression.right.type}`);
            console.log(`Values: ${left} ${expression.operator} ${right}`);
            switch (expression.operator) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/': return left / right;
                case '%': return left % right;
                case '==': return left == right;
                case '!=': return left != right;
                case '===': return left === right;
                case '!==': return left !== right;
                case '<': return left < right;
                case '<=': return left <= right;
                case '>': return left > right;
                case '>=': return left >= right;
                case '&&': return left && right;
                case '||': return left || right;
                default: throw new Error(`Unsupported binary operator ${expression.operator}`);
            }
        case 'UnaryExpression':
            const argument = evaluateExpression(expression.argument, context);
            switch (expression.operator) {
                case '-': return -argument;
                case '+': return +argument;
                case '!': return !argument;
                default: throw new Error(`Unsupported unary operator ${expression.operator}`);
            }
        case 'UpdateExpression':
            const oldValue = context.variables[expression.argument.name];
            if (expression.operator === '++') {
                context.variables[expression.argument.name] = oldValue + 1;
            } else if (expression.operator === '--') {
                context.variables[expression.argument.name] = oldValue - 1;
            }
            return expression.prefix ? context.variables[expression.argument.name] : oldValue;
        case 'AssignmentExpression':
            const value = evaluateExpression(expression.right, context);
            context.variables[expression.left.name] = value;
            return value;
        case 'ArrayExpression':
            return expression.elements.map(element => evaluateExpression(element, context));
        case 'MemberExpression':
            if (!expression.computed) {
                const object = evaluateExpression(expression.object, context);
                const property = expression.property.name;
                if (property === 'length' && Array.isArray(object)) {
                    return object.length;
                }
                // Handle other non-computed properties or throw an error if unsupported
            }
            const arrayName = expression.object.name;
            const index = evaluateExpression(expression.property, context);
            if (!context.variables[arrayName]) {
                throw new Error(`Array ${arrayName} is not defined`);
            }
            if (index < 0 || index >= context.variables[arrayName].length) {
                throw new Error(`Array index ${index} out of bounds for ${arrayName}`);
            }
            return context.variables[arrayName][index];
        case 'CallExpression':
            const callee = expression.callee.name;
            const args = expression.arguments.map(arg => evaluateExpression(arg, context));
            if (!context.functions[callee]) {
                throw new Error(`Function ${callee} is not defined`);
            }
            return context.functions[callee].apply(null, args);
        default:
            console.log('Unsupported expression type encountered:', expression);
            throw new Error(`Unsupported expression type: ${expression.type}`);
    }
}

function updateHistory(context, line, action, details) {
    context.history.push({
        line: line,
        action: action,
        details: details // This object can contain variableName, value, comparedIndices, swappedIndices, etc.
    });
}


// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = {
    handleVariableDeclaration,
    simulateExecution,
    handleForStatement,
    handleIfStatement
    // ... any other functions you want to test
  };